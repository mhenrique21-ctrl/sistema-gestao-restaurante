import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { paraGemini, respostaDoGemini, erroDoGemini, valeTentarReserva, aceitaNivelDeRaciocinio, filaDeModelos, MODELOS_PADRAO, MSG_COTA_DIARIA_GEMINI, MSG_LIMITE_MINUTO_GEMINI } from './iaGemini.js';

// Análise do código sob teste (iaGemini.js):
// - Input: o pedido que o app já monta no formato da Anthropic (system,
//   messages com blocos image/text, max_tokens), e as respostas cruas do
//   Gemini (200 ou erro).
// - Output: o corpo do generateContent na ida; na volta, um objeto no formato
//   da Anthropic (content[].text, stop_reason, usage) ou { error: { type } }
//   com os mesmos tipos que new_server.js já classifica.
// - Sem efeitos colaterais: funções puras, sem rede.
// - Existe para trocar de provedor pelo .env sem reescrever a tela nem o
//   tratamento de erro do /api/scan.

const IMG = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } };

describe('paraGemini', () => {
  test('imagem + texto do cupom viram parts na ordem, system vira systemInstruction', () => {
    const body = paraGemini({
      system: 'Você é um OCR',
      messages: [{ role: 'user', content: [IMG, { type: 'text', text: 'Leia o cupom' }] }],
      max_tokens: 8192,
      json: true,
    });
    assert.deepEqual(body.systemInstruction, { parts: [{ text: 'Você é um OCR' }] });
    assert.equal(body.contents.length, 1);
    assert.equal(body.contents[0].role, 'user');
    assert.deepEqual(body.contents[0].parts, [
      { inline_data: { mime_type: 'image/jpeg', data: 'AAAA' } },
      { text: 'Leia o cupom' },
    ]);
    assert.deepEqual(body.generationConfig, { maxOutputTokens: 16384, responseMimeType: 'application/json' });
  });

  test('conteúdo em string simples (rotas de conciliação) vira uma part de texto', () => {
    const body = paraGemini({ messages: [{ role: 'user', content: 'Responda apenas: OK' }], max_tokens: 50 });
    assert.deepEqual(body.contents[0].parts, [{ text: 'Responda apenas: OK' }]);
    assert.equal(body.systemInstruction, undefined);
    assert.equal(body.generationConfig.responseMimeType, undefined);
    // piso de 16384: o raciocínio do Gemini conta dentro do limite
    assert.equal(body.generationConfig.maxOutputTokens, 16384);
  });

  test('várias imagens na mesma mensagem (fechamento combinado) são todas preservadas', () => {
    const body = paraGemini({ messages: [{ role: 'user', content: [IMG, IMG, IMG, { type: 'text', text: 'x' }] }], max_tokens: 10 });
    assert.equal(body.contents[0].parts.filter(p => p.inline_data).length, 3);
  });

  test('role assistant vira model; bloco desconhecido é descartado', () => {
    const body = paraGemini({
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'tool_use', id: 'x' }] },
        { role: 'assistant', content: 'b' },
      ],
      max_tokens: 10,
    });
    assert.deepEqual(body.contents[0].parts, [{ text: 'a' }]);
    assert.equal(body.contents[1].role, 'model');
  });
});

describe('respostaDoGemini', () => {
  test('texto e uso viram o formato da Anthropic que a tela já lê', () => {
    const r = respostaDoGemini({
      candidates: [{ content: { parts: [{ text: '{"itens":' }, { text: '[]}' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 300 },
    }, 'gemini-x');
    assert.equal(r.error, undefined);
    assert.equal(r.content.map(c => c.text).join(''), '{"itens":[]}');
    assert.equal(r.stop_reason, 'end_turn');
    assert.equal(r.model, 'gemini-x');
    assert.deepEqual(r.usage, { input_tokens: 1200, output_tokens: 300 });
  });

  test('parts de raciocínio (thought) não entram no texto', () => {
    const r = respostaDoGemini({ candidates: [{ content: { parts: [{ text: 'pensando', thought: true }, { text: 'OK' }] } }] }, 'm');
    assert.equal(r.content[0].text, 'OK');
  });

  test('MAX_TOKENS vira stop_reason max_tokens', () => {
    const r = respostaDoGemini({ candidates: [{ content: { parts: [{ text: '{' }] }, finishReason: 'MAX_TOKENS' }] }, 'm');
    assert.equal(r.stop_reason, 'max_tokens');
  });

  test('bloqueio de segurança ou candidato sem conteúdo vira erro definitivo com o motivo', () => {
    const r1 = respostaDoGemini({ promptFeedback: { blockReason: 'SAFETY' } }, 'm');
    assert.equal(r1.error.type, 'invalid_request_error');
    assert.match(r1.error.message, /SAFETY/);
    const r2 = respostaDoGemini({ candidates: [{ finishReason: 'RECITATION' }] }, 'm');
    assert.match(r2.error.message, /RECITATION/);
    assert.match(respostaDoGemini(null, 'm').error.message, /sem resposta/);
  });
});

describe('erroDoGemini', () => {
  test('chave inválida vira authentication_error (a tela esconde as dicas de foto)', () => {
    const r = erroDoGemini(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } });
    // O Google devolve chave inválida como 400 INVALID_ARGUMENT; só o texto
    // diz o que é. Sem chave nenhuma vem 403 PERMISSION_DENIED.
    assert.equal(r.error.type, 'authentication_error');
    const r2 = erroDoGemini(403, { error: { code: 403, message: 'Method doesn\'t allow unregistered callers', status: 'PERMISSION_DENIED' } });
    assert.equal(r2.error.type, 'authentication_error');
  });

  test('429 com quotaId PerDay é cota do dia: tipo próprio e mensagem em português', () => {
    const r = erroDoGemini(429, { error: {
      code: 429, status: 'RESOURCE_EXHAUSTED',
      message: 'You exceeded your current quota, please check your plan and billing details.',
      details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }],
    } });
    assert.equal(r.error.type, 'daily_quota_error');
    assert.equal(r.error.message, MSG_COTA_DIARIA_GEMINI);
    // A mensagem crua tinha "billing details" — não pode vazar, senão
    // semCredito() manda comprar crédito na Anthropic.
    assert.doesNotMatch(r.error.message, /billing/i);
  });

  test('429 com quotaId PerMinute é limite por minuto: rate_limit_error, o servidor retenta', () => {
    const r = erroDoGemini(429, { error: {
      code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota, please check your plan and billing details.',
      details: [{ violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] }],
    } });
    assert.equal(r.error.type, 'rate_limit_error');
    assert.equal(r.error.message, MSG_LIMITE_MINUTO_GEMINI);
  });

  test('429 sem details também é tratado como limite por minuto (retentável)', () => {
    assert.equal(erroDoGemini(429, { error: { message: 'Resource has been exhausted' } }).error.type, 'rate_limit_error');
  });

  test('503 vira overloaded_error, 404 vira not_found_error, corpo não-JSON vira api_error com o texto', () => {
    assert.equal(erroDoGemini(503, { error: { status: 'UNAVAILABLE', message: 'The model is overloaded.' } }).error.type, 'overloaded_error');
    assert.equal(erroDoGemini(404, { error: { status: 'NOT_FOUND', message: 'models/x is not found' } }).error.type, 'not_found_error');
    const r = erroDoGemini(502, '<html>Bad Gateway</html>');
    assert.equal(r.error.type, 'api_error');
    assert.match(r.error.message, /Bad Gateway/);
    assert.equal(erroDoGemini(500, null).error.message, 'HTTP 500');
  });
});

describe('valeTentarReserva', () => {
  test('sobrecarga, limite por minuto, cota do dia e modelo inexistente passam para o reserva', () => {
    for (const tipo of ['overloaded_error', 'rate_limit_error', 'daily_quota_error', 'not_found_error', 'api_error']) {
      assert.equal(valeTentarReserva(tipo), true, tipo);
    }
  });
  test('chave errada e pedido inválido não: falhariam igual no outro modelo', () => {
    assert.equal(valeTentarReserva('authentication_error'), false);
    assert.equal(valeTentarReserva('invalid_request_error'), false);
  });
});

// ── O raciocínio que comia a resposta ──────────────────────────────────────
// Os modelos Gemini 3 raciocinam por padrão em nível MÉDIO, e os tokens de
// raciocínio contam DENTRO do maxOutputTokens. Num cupom com muitos itens o
// modelo estourava o limite pensando e devolvia 200 com zero texto — e a
// tradução entregava isso como resposta VAZIA de sucesso. O sintoma na loja:
// "o leitor de cupom parou de ler os cupons", sem erro nenhum na tela.

test('o pedido pede raciocínio BAIXO nos modelos Gemini 3', () => {
  const g = paraGemini({ messages: [], model: 'gemini-3.8-flash' }).generationConfig;
  assert.equal(g.thinkingConfig.thinkingLevel, 'LOW');
});

test('⚠️ modelo anterior ao 3 NÃO recebe thinkingLevel — lá isso é erro', () => {
  assert.equal(paraGemini({ messages: [], model: 'gemini-2.5-flash' }).generationConfig.thinkingConfig, undefined);
  assert.equal(paraGemini({ messages: [] }).generationConfig.thinkingConfig, undefined, 'sem nome de modelo, não arrisca');
  assert.equal(paraGemini({ messages: [], model: 'gemini-omni-1.1-flash' }).generationConfig.thinkingConfig, undefined);
});

test('aceitaNivelDeRaciocinio lê a versão do nome', () => {
  assert.equal(aceitaNivelDeRaciocinio('gemini-3.5-flash-lite'), true);
  assert.equal(aceitaNivelDeRaciocinio('gemini-3-flash-preview'), true);
  assert.equal(aceitaNivelDeRaciocinio('gemini-2.5-flash'), false);
  assert.equal(aceitaNivelDeRaciocinio(''), false);
});

test('o teto de saída cobre cupom longo + raciocínio', () => {
  assert.equal(paraGemini({ messages: [], max_tokens: 1000 }).generationConfig.maxOutputTokens, 16384);
  assert.equal(paraGemini({ messages: [], max_tokens: 40000 }).generationConfig.maxOutputTokens, 40000);
});

test('⚠️ 200 sem texto é ERRO, não cupom em branco', () => {
  // `parts: []` é um array — passava pela checagem antiga e virava
  // content:[{text:""}], que a tela lia como um cupom sem nenhum item.
  const r = respostaDoGemini({
    candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }],
    usageMetadata: { thoughtsTokenCount: 8192 },
  }, 'gemini-3.8-flash');
  assert.equal(r.error.type, 'sem_resposta_error');
  assert.match(r.error.message, /raciocinando/);
  assert.match(r.error.message, /8192/);
});

test('parte só de raciocínio também não é resposta', () => {
  const r = respostaDoGemini({
    candidates: [{ content: { parts: [{ text: 'deixa eu ver...', thought: true }] }, finishReason: 'MAX_TOKENS' }],
  }, 'm');
  assert.equal(r.error.type, 'sem_resposta_error');
});

test('⚠️ truncar vale trocar de modelo; recusa de conteúdo, não', () => {
  // É a diferença entre tentar o reserva (que pensa menos) e parar de vez.
  const truncado = respostaDoGemini({ candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] }, 'm');
  assert.equal(valeTentarReserva(truncado.error.type), true);
  const recusado = respostaDoGemini({ candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] }, 'm');
  assert.equal(recusado.error.type, 'invalid_request_error');
  assert.equal(valeTentarReserva(recusado.error.type), false);
});

test('resposta de verdade continua passando inteira', () => {
  const r = respostaDoGemini({
    candidates: [{ content: { parts: [{ text: 'pensei', thought: true }, { text: '{"itens":[]}' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  }, 'gemini-3.8-flash');
  assert.equal(r.error, undefined);
  assert.equal(r.content[0].text, '{"itens":[]}');
  assert.equal(r.stop_reason, 'end_turn');
});

// ── A fila de modelos ──────────────────────────────────────────────────────
// Dois modelos não bastam: em 22/09/2026 o /api/ia-status pegou o
// gemini-3.8-flash com 503 "high demand" numa terça de manhã e o leitor de
// cupom ficou sem ler. Com fila de dois, basta os dois congestionarem junto.

test('a fila padrão desce por QUALIDADE, com o Lite por último', () => {
  // Cupom lido errado é pior que cupom não lido: o errado vira compra com
  // valor plausível e só aparece no CMV do mês. Por isso só se desce quando o
  // de cima recusa, e o Lite — o mais fraco de olhar foto ruim — fica no fim.
  assert.equal(MODELOS_PADRAO[0], 'gemini-3.8-flash');
  assert.equal(MODELOS_PADRAO[MODELOS_PADRAO.length - 1], 'gemini-3.5-flash-lite');
  assert.ok(MODELOS_PADRAO.length >= 4, 'fila curta demais volta a ficar sem saída');
  assert.deepEqual(filaDeModelos({}), MODELOS_PADRAO);
});

test('GEMINI_MODEL e GEMINI_MODEL_RESERVA seguem valendo, e vêm na FRENTE', () => {
  // Quem configurou escolheu; o padrão entra atrás como rede, sem repetir.
  const f = filaDeModelos({ principal: 'gemini-3.8-flash', reserva: 'gemini-3.5-flash-lite' });
  assert.equal(f[0], 'gemini-3.8-flash');
  assert.equal(f[1], 'gemini-3.5-flash-lite');
  assert.equal(new Set(f).size, f.length, 'não pode repetir modelo na fila');
  assert.ok(f.length > 2, 'a rede de trás precisa entrar');
});

test('GEMINI_MODELOS fixa a fila inteira, para quem quer travar', () => {
  assert.deepEqual(filaDeModelos({ lista: 'gemini-3.5-flash , gemini-3.6-flash', principal: 'gemini-3.8-flash' }),
    ['gemini-3.5-flash', 'gemini-3.6-flash']);
});

test('espaço, vírgula sobrando e vazio não viram modelo fantasma', () => {
  assert.deepEqual(filaDeModelos({ lista: ' , , ' }), MODELOS_PADRAO, 'lista só de lixo cai no padrão');
  assert.deepEqual(filaDeModelos({ lista: 'a,,b, ' }), ['a', 'b']);
});

test('⚠️ o 503 real de 22/09/2026 desce a fila em vez de parar', () => {
  // Texto exato que o /api/ia-status trouxe do gemini-3.8-flash naquele dia.
  const e = erroDoGemini(503, { error: { code: 503, status: 'UNAVAILABLE',
    message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.' } });
  assert.equal(e.error.type, 'overloaded_error');
  assert.equal(valeTentarReserva(e.error.type), true, 'sobrecarga é DO MODELO: o seguinte da fila pode estar livre');
});
