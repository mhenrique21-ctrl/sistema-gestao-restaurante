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
export function paraGemini({ system, messages, max_tokens, json = false }) {
  const body = {
    contents: (messages || []).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: blocosParaParts(m.content),
    })),
    // No Gemini os tokens de raciocínio contam dentro do maxOutputTokens: com o
    // limite baixo ele pensa, estoura e devolve vazio. O piso é só um teto (não
    // custa nada a mais), então vale para qualquer pedido.
    generationConfig: { maxOutputTokens: Math.max(max_tokens || 0, 8192) },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (json) body.generationConfig.responseMimeType = 'application/json';
  return body;
}

// Resposta 200 do Gemini → corpo no formato da Anthropic. Quando o Gemini
// bloqueia (filtro de segurança) ou estoura o limite sem devolver texto, sai um
// `error` no mesmo formato, para o servidor tratar como qualquer outro erro.
export function respostaDoGemini(j, model) {
  const cand = j?.candidates?.[0];
  const parts = cand?.content?.parts;
  if (!cand || !Array.isArray(parts)) {
    const motivo = j?.promptFeedback?.blockReason || cand?.finishReason || 'sem resposta';
    return { error: { type: 'invalid_request_error', message: `O Gemini não devolveu resposta (${motivo}).` } };
  }
  // `thought: true` são resumos de raciocínio (só vêm se pedidos) — não são a resposta.
  const text = parts.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('');
  const u = j.usageMetadata || {};
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
