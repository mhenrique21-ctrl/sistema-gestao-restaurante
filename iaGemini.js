// Tradução entre o formato da Anthropic e o do Gemini — usada por new_server.js
// quando IA_PROVIDER=gemini (a faixa gratuita do Google AI Studio).
//
// O app inteiro fala o formato da Anthropic: a tela monta `messages` com blocos
// {type:'image'|'text'}, e lê a resposta em `content[].text`; o servidor
// classifica erro por `error.type` (authentication_error, rate_limit_error...).
// Em vez de reescrever tudo isso, o servidor traduz na ida e na volta e o resto
// do sistema não precisa saber qual provedor respondeu.
//
// Funções puras: não fazem rede. A chamada HTTPS fica em new_server.js.

// Mensagens já em português porque a crua do Google vem em inglês e menciona
// "billing details" mesmo no limite gratuito — o que fazia semCredito() em
// new_server.js mandar o usuário comprar crédito na Anthropic.
export const MSG_COTA_DIARIA_GEMINI = 'Limite diário gratuito do Gemini atingido. '
  + 'Ele volta à meia-noite no horário da Califórnia (por volta das 4h/5h no Brasil). '
  + 'Enquanto isso, dá para colar o texto do cupom no campo abaixo, ou trocar para '
  + 'IA_PROVIDER=anthropic no .env da VPS.';
export const MSG_LIMITE_MINUTO_GEMINI = 'Muitas leituras ao Gemini em pouco tempo. Aguarde um minuto e tente de novo.';

// Depois de um erro no modelo principal, vale tentar o reserva? Só não vale
// quando o erro é da chave ou do pedido — esses falham igual em qualquer
// modelo. Sobrecarga (503), limite por minuto, cota do dia (que é POR
// modelo na faixa gratuita) e modelo inexistente mudam de um para o outro.
export const valeTentarReserva = (type) => !['authentication_error', 'invalid_request_error'].includes(type);

// ⚠️ O RACIOCÍNIO CABE DENTRO DO maxOutputTokens, E FOI O QUE PAROU DE LER
// CUPOM. Os modelos Gemini 3 raciocinam por padrão em nível MÉDIO, e a doc do
// Google é explícita: o max_output_tokens "atua como um limite rígido sem mudar
// a forma como o modelo aloca o orçamento de raciocínio — se o modelo atingir
// esse limite durante o raciocínio, ele para com status incomplete e devolve
// saída TRUNCADA OU VAZIA". Num cupom com muitos itens é exatamente o que
// acontecia: 200 OK, zero texto, e a tela recebia um cupom "lido" em branco.
//
// A própria doc diz qual é a alavanca: "para reduzir custo ou latência sem
// truncar as respostas, diminua thinking_level em vez de definir um
// max_output_tokens pequeno". Ler cupom é extração, não raciocínio.
//
// ⚠️ LOW, não MINIMAL: o 3.8 Flash aceita baixo/médio/alto e recusa mínimo.
// ⚠️ E só em Gemini 3+: mandar thinkingLevel para modelo anterior dá ERRO. Nome
// fora do padrão não arrisca — segue sem o campo, como era antes.
export const NIVEL_RACIOCINIO = 'LOW';

export function aceitaNivelDeRaciocinio(model) {
  const m = /^gemini-(\d+)/.exec(String(model || '').trim().toLowerCase());
  return !!m && Number(m[1]) >= 3;
}

function blocosParaParts(content) {
  if (typeof content === 'string') return [{ text: content }];
  return (content || []).map(b => {
    if (b?.type === 'image' && b.source?.type === 'base64') {
      return { inline_data: { mime_type: b.source.media_type, data: b.source.data } };
    }
    if (b?.type === 'text') return { text: b.text || '' };
    return null;
  }).filter(Boolean);
}

// Pedido no formato da Anthropic ({ system, messages, max_tokens }) → corpo do
// generateContent. `json: true` liga o modo JSON do Gemini: a resposta vem sem
// cerca de markdown nem texto solto, que é o que os prompts de cupom pedem.
export function paraGemini({ system, messages, max_tokens, json = false, model = '' }) {
  const body = {
    contents: (messages || []).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: blocosParaParts(m.content),
    })),
    // No Gemini os tokens de raciocínio contam dentro do maxOutputTokens: com o
    // limite baixo ele pensa, estoura e devolve vazio. O piso é só um teto (não
    // custa nada a mais, porque só se paga o que sai), então vale para qualquer
    // pedido — e subiu para 16k porque 8k não cobria cupom longo + raciocínio.
    generationConfig: { maxOutputTokens: Math.max(max_tokens || 0, 16384) },
  };
  if (aceitaNivelDeRaciocinio(model)) {
    body.generationConfig.thinkingConfig = { thinkingLevel: NIVEL_RACIOCINIO };
  }
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (json) body.generationConfig.responseMimeType = 'application/json';
  return body;
}

// Resposta 200 do Gemini → corpo no formato da Anthropic. Quando o Gemini
// bloqueia (filtro de segurança) ou estoura o limite sem devolver texto, sai um
// `error` no mesmo formato, para o servidor tratar como qualquer outro erro.
// Bloqueio de conteúdo não muda trocando de modelo; truncar, sim — e são os
// dois caminhos que chegam aqui sem texto.
const BLOQUEIO = /SAFETY|BLOCK|PROHIBITED|RECITATION|LANGUAGE/i;

export function respostaDoGemini(j, model) {
  const cand = j?.candidates?.[0];
  const parts = Array.isArray(cand?.content?.parts) ? cand.content.parts : [];
  // `thought: true` são resumos de raciocínio (só vêm se pedidos) — não são a resposta.
  const text = parts.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('');
  const u = j?.usageMetadata || {};

  // ⚠️ SEM TEXTO É ERRO, NUNCA RESPOSTA VAZIA. Antes só a AUSÊNCIA de `parts`
  // virava erro; um `parts` que existe mas não tem texto nenhum — o caso do
  // raciocínio que estourou o limite, e o que fez o leitor "parar de ler os
  // cupons" — passava como sucesso, e a tela recebia 200 com um cupom em
  // branco. Erro em silêncio é o que este arquivo existe para não ter.
  if (!text.trim()) {
    const motivo = j?.promptFeedback?.blockReason || cand?.finishReason || 'sem resposta';
    const pensados = u.thoughtsTokenCount || 0;
    if (BLOQUEIO.test(String(motivo))) {
      return { error: { type: 'invalid_request_error', message: `O Gemini recusou a imagem (${motivo}).` } };
    }
    return { error: { type: 'sem_resposta_error', message: motivo === 'MAX_TOKENS' || pensados
      ? `O Gemini gastou o limite de saída raciocinando e não sobrou resposta (${motivo}${pensados ? `, ${pensados} tokens de raciocínio` : ''}).`
      : `O Gemini não devolveu resposta (${motivo}).` } };
  }
  return {
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text }],
    stop_reason: cand.finishReason === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn',
    usage: { input_tokens: u.promptTokenCount || 0, output_tokens: u.candidatesTokenCount || 0 },
  };
}

// Erro do Gemini (status HTTP + corpo) → { error: { type, message } } com os
// mesmos `type` da Anthropic, para erroDefinitivo()/problemaDeConta() e as
// mensagens da tela continuarem valendo.
//
// O 429 precisa de cuidado: o Google usa o MESMO texto para "muitas por minuto"
// e "acabou a cota do dia"; quem diferencia é o quotaId em `details`. Cota do
// dia é definitiva (não adianta tentar de novo até a virada), por isso vira um
// tipo próprio, `daily_quota_error`, que o servidor não retenta.
export function erroDoGemini(status, j) {
  const e = (j && typeof j === 'object' && j.error) || {};
  const st = e.status || '';
  const cru = e.message || (typeof j === 'string' ? j.slice(0, 200) : '') || `HTTP ${status}`;
  let type = 'api_error';
  let message = cru;
  // Chave errada chega como 400 INVALID_ARGUMENT "API key not valid" — o mesmo
  // código de uma imagem ilegível. Sem reconhecer o texto, a tela mandaria
  // refotografar o cupom por um problema de configuração (ver CLAUDE.md,
  // "Cupom IA — erro da API").
  const chaveInvalida = /API key not valid|API_KEY_INVALID/i.test(cru + JSON.stringify(e.details || ''));
  if (status === 401 || status === 403 || st === 'UNAUTHENTICATED' || st === 'PERMISSION_DENIED' || chaveInvalida) {
    type = 'authentication_error';
  } else if (status === 429 || st === 'RESOURCE_EXHAUSTED') {
    const detalhes = JSON.stringify(e.details || '');
    if (/PerDay|Daily/i.test(detalhes)) { type = 'daily_quota_error'; message = MSG_COTA_DIARIA_GEMINI; }
    else { type = 'rate_limit_error'; message = MSG_LIMITE_MINUTO_GEMINI; }
  } else if (status === 503 || st === 'UNAVAILABLE') {
    type = 'overloaded_error';
  } else if (status === 400 || st === 'INVALID_ARGUMENT') {
    type = 'invalid_request_error';
  } else if (status === 404 || st === 'NOT_FOUND') {
    type = 'not_found_error';
  }
  return { error: { type, message } };
}
