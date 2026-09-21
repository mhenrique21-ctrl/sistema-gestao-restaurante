// Autenticação — o que protege o sistema de verdade.
// ============================================================================
// Até 21/09/2026 NÃO EXISTIA autenticação nenhuma no servidor. O comentário no
// `new_server.js` dizia, com todas as letras, "quem protege o sistema é a tela
// de senha" — e aquela tela era client-side:
//
//   • `GET /api/dados/CONFRARIA` devolvia o banco INTEIRO sem pedir nada:
//     vendas, compras, fornecedores com CNPJ, folha e faltas dos funcionários,
//     clientes com nome/telefone/endereço;
//   • `POST /api/dados/<empresa>` aceitava sobrescrever tudo, também sem pedir;
//   • a senha de admin viajava DENTRO do bundle servido ao navegador, e a lista
//     de usuários (com as senhas em texto puro) vinha nesse mesmo JSON público.
//
// Tudo aqui é função pura, com teste, porque erro de autenticação não aparece na
// tela: aparece no dia em que alguém percebe que a URL responde sem senha.

import crypto from 'node:crypto';

export const COOKIE_SESSAO = 'app_sessao';
export const SESSAO_HORAS = 24;

// ── A sessão é ASSINADA, não guardada ───────────────────────────────────────
// ⚠️ SEM ESTADO NO SERVIDOR DE PROPÓSITO. Uma tabela de sessões em memória
// esvazia a cada `pm2 restart` — e restart é o passo final de todo deploy, o que
// derrubaria a loja inteira no meio do serviço a cada publicação. Assinada, a
// sessão sobrevive ao restart, e quem revoga é o carimbo `sessoesValidasApos`
// que o botão "Desconectar todos os aparelhos" já gravava (§6) — ele deixou de
// ser um pedido gentil ao cliente e passou a ser conferido aqui.
export function assinarSessao(payload, secret) {
  if (!secret) return null;
  const corpo = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(corpo).digest('base64url');
  return `${corpo}.${mac}`;
}

export function lerSessao(valor, secret) {
  if (!valor || !secret) return null;
  const partes = String(valor).split('.');
  if (partes.length !== 2) return null;
  const [corpo, mac] = partes;
  const esperado = crypto.createHmac('sha256', secret).update(corpo).digest('base64url');
  // ⚠️ COMPARAÇÃO EM TEMPO CONSTANTE. `===` em string vaza, pelo tempo de
  // resposta, quantos caracteres do MAC estavam certos — é o bastante para
  // forjar um cookie byte a byte.
  const a = Buffer.from(mac);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf-8'));
    if (!p || typeof p !== 'object' || !p.em) return null;
    // Validade própria: cookie sem prazo é "logado para sempre".
    if (Date.now() - Number(p.em) > SESSAO_HORAS * 3600 * 1000) return null;
    return p;
  } catch { return null; }
}

// ⚠️ O CARIMBO É O MAIOR DOS DOIS (uma empresa por arquivo). "Desconectar todos"
// gravado só na Confraria tem que derrubar a sessão de quem está na Seama
// também — o aparelho é o mesmo, e a ordem foi dada pelo mesmo admin.
export function sessaoValida(payload, sessoesValidasApos) {
  if (!payload) return false;
  const corte = Number(sessoesValidasApos) || 0;
  return !corte || Number(payload.em) >= corte;
}

// ── A senha guardada NÃO é a senha ──────────────────────────────────────────
// Fase 4 (21/09/2026). A Fase 3 tirou a lista de senhas do navegador de quem
// NÃO está logado. Faltava o outro lado: `db.usuarios[].senha` estava em texto
// puro dentro do documento, e o documento vai inteiro para quem TEM sessão —
// então qualquer operador logado lia a senha do administrador no JSON, pelo
// navegador. Havia até um botão "👁 ver senha" em duas telas.
//
// ⚠️ SCRYPT, NÃO SHA. Hash rápido sobre um código de 4 dígitos é resolvido por
// força bruta em microssegundos: são 10 mil candidatos. O custo do scrypt é o
// que transforma isso em trabalho — e é por isso que ele não pode ser "só um
// hash qualquer".
//
// ⚠️ SAL POR USUÁRIO, dentro do próprio valor guardado. Com sal único, dois
// operadores com o mesmo código teriam o mesmo hash, e olhar o JSON diria quem
// compartilha senha com quem.
//
// ⚠️ O CUSTO É PAGO POR USUÁRIO A CADA LOGIN, e isso é consequência de o login
// ser SÓ senha, sem nome: não há como saber qual registro conferir antes de
// tentar. Com N=2^14 e poucos usuários fica em fração de segundo; se um dia a
// lista crescer muito, o caminho é pedir o nome no login, não enfraquecer o
// hash.
const SCRYPT_N = 16384;
const HASH_BYTES = 32;
const PREFIXO_HASH = 'scrypt$';

export function hashSenha(senha) {
  const p = String(senha ?? '').trim();
  if (!p) return '';
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(p, sal, HASH_BYTES, { N: SCRYPT_N, r: 8, p: 1 });
  return `${PREFIXO_HASH}${SCRYPT_N}$${sal.toString('hex')}$${h.toString('hex')}`;
}

export function ehHash(v) {
  return typeof v === 'string' && v.startsWith(PREFIXO_HASH);
}

// ⚠️ ACEITA O TEXTO PURO ANTIGO, de propósito. Migrar tudo de uma vez e recusar
// o resto trancaria fora quem estivesse com um aparelho sem sincronizar, ou com
// o arquivo restaurado de um backup anterior à migração. O legado é reconhecido
// na leitura — a mesma regra do `LEGADO` do `tipoInsumo.js` — e o servidor
// reescreve em hash quando encontra.
export function conferirSenha(guardado, digitada) {
  const p = String(digitada ?? '').trim();
  if (!p || typeof guardado !== 'string' || !guardado) return false;
  if (!ehHash(guardado)) return igual(guardado.trim(), p);
  const partes = guardado.slice(PREFIXO_HASH.length).split('$');
  if (partes.length !== 3) return false;
  const [nTxt, salHex, hashHex] = partes;
  const N = Number(nTxt);
  if (!Number.isInteger(N) || N < 2 || (N & (N - 1)) !== 0) return false;
  // ⚠️ O TAMANHO É FIXO, NÃO SAI DO VALOR GUARDADO. Derivando o keylen do que
  // está gravado, um hash TRUNCADO continuava conferindo: a comparação passava
  // a ser só sobre o prefixo que sobrou, e quanto mais curto, mais fácil.
  try {
    const a = Buffer.from(hashHex, 'hex');
    if (a.length !== HASH_BYTES) return false;
    const h = crypto.scryptSync(p, Buffer.from(salHex, 'hex'), HASH_BYTES, { N, r: 8, p: 1 });
    return crypto.timingSafeEqual(a, h);
  } catch { return false; }
}

// O que sai para o navegador no lugar da senha.
//
// ⚠️ `temSenha` NÃO É COSMÉTICO: as telas de usuário precisam distinguir
// "usuário sem senha definida" de "senha existe e não vou te mostrar". Sem esse
// sinal, as duas viram um campo vazio, e a pessoa não sabe se precisa preencher.
export function semSenhas(usuarios) {
  return (usuarios || []).map((u) => {
    if (!u || typeof u !== 'object') return u;
    const { senha, ...resto } = u;
    return { ...resto, temSenha: !!(typeof senha === 'string' && senha.trim()) };
  });
}

// ⚠️ A SENHA GUARDADA É PRESERVADA quando o incoming vem SEM ela. O cliente
// recebe os usuários sem senha (acima) e devolve o documento inteiro no POST:
// sem esta preservação, a PRIMEIRA gravação de qualquer tela apagaria a senha de
// todo mundo — e o sistema ficaria sem ninguém capaz de entrar. Campo vazio
// significa "não mexi"; para trocar, a tela manda a senha nova.
export function preservarSenhas(usuariosFundidos, usuariosGuardados) {
  const antes = new Map((usuariosGuardados || []).filter((u) => u?.id).map((u) => [u.id, u]));
  return (usuariosFundidos || []).map((u) => {
    if (!u || typeof u !== 'object') return u;
    const { temSenha, ...limpo } = u;
    const nova = typeof u.senha === 'string' ? u.senha.trim() : '';
    if (nova) return { ...limpo, senha: ehHash(nova) ? nova : hashSenha(nova) };
    const guardada = antes.get(u.id)?.senha;
    return guardada ? { ...limpo, senha: guardada } : limpo;
  });
}

// ── Quem é o dono desta senha ───────────────────────────────────────────────
// ⚠️ A CONFERÊNCIA MUDOU DE LADO, e é isso que importa: antes o navegador
// recebia a lista de usuários e comparava; agora a senha vai para o servidor e
// só a identidade volta. A lista de senhas nunca mais sai daqui.
//
// ⚠️ A ORDEM É: usuários cadastrados primeiro, depois o admin do `.env`. O
// cadastro é o que a pessoa mantém em Configurações → Usuários; o do `.env` é o
// pé-de-meia para quando não há cadastro nenhum (instalação nova) e para não
// existir sistema sem entrada possível.
export function acharUsuario(senha, { usuarios = [], adminSenha = '', adminLabel = 'Administrativo' } = {}) {
  const p = String(senha ?? '').trim();
  if (!p) return null;
  for (const u of usuarios) {
    // ⚠️ `conferirSenha` compara em tempo constante e aceita o texto puro
    // antigo: com `===`, o tempo de resposta do login diz quantos dígitos do
    // código estavam certos, e um código de 4 dígitos cai em minutos.
    if (u && conferirSenha(u.senha, p)) {
      return { role: u.role || 'op', label: u.nome || 'Usuário', empresa: u.empresa || undefined,
        corTexto: u.corTexto || undefined, fonte: 'cadastro' };
    }
  }
  if (adminSenha && igual(String(adminSenha).trim(), p)) {
    return { role: 'admin', label: adminLabel, fonte: 'env' };
  }
  return null;
}

function igual(a, b) {
  const A = Buffer.from(String(a), 'utf-8');
  const B = Buffer.from(String(b), 'utf-8');
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

// ── Cookies ─────────────────────────────────────────────────────────────────
export function lerCookies(header) {
  const out = {};
  for (const parte of String(header || '').split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    const k = parte.slice(0, i).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return out;
}

// ⚠️ `HttpOnly` não é enfeite: sem ele qualquer script da página lê o cookie, e
// a sessão volta a ser tão exposta quanto a senha no bundle era.
// ⚠️ `Secure` sai do protocolo REAL da requisição (`x-forwarded-proto`, que o
// Nginx manda). Fixado em `true`, o cookie não subiria num acesso HTTP direto e
// o login falharia sem dizer por quê; fixado em `false`, viajaria em claro.
export function montarCookieSessao(valor, { https = true, maxAgeSeg = SESSAO_HORAS * 3600 } = {}) {
  const partes = [`${COOKIE_SESSAO}=${encodeURIComponent(valor)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeg}`];
  if (https) partes.push('Secure');
  return partes.join('; ');
}

export function cookieDeSaida({ https = true } = {}) {
  return montarCookieSessao('', { https, maxAgeSeg: 0 });
}

export function ehHttps(req) {
  const proto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (proto) return proto === 'https';
  return !!req?.socket?.encrypted;
}

// ── A porta dos dados ───────────────────────────────────────────────────────
// ⚠️ O SEGREDO DE SERVIÇO CONTINUA VALENDO como alternativa à sessão. Os agentes
// (Eclética, impressora) e os PDVs irmãos já se autenticam com
// `x-service-secret` e não têm navegador para guardar cookie: exigir sessão
// deles cortaria a ponte do caixa sem que ninguém ligasse uma coisa à outra.
export function autorizarDados(req, { secret, serviceSecret, sessoesValidasApos } = {}) {
  const dado = req?.headers?.['x-service-secret'];
  if (serviceSecret && dado && igual(dado, serviceSecret)) {
    return { ok: true, via: 'servico' };
  }
  const cookies = lerCookies(req?.headers?.cookie);
  const payload = lerSessao(cookies[COOKIE_SESSAO], secret);
  if (!payload) return { ok: false, motivo: 'sem sessão' };
  if (!sessaoValida(payload, sessoesValidasApos)) return { ok: false, motivo: 'sessão revogada' };
  return { ok: true, via: 'sessao', login: payload };
}
