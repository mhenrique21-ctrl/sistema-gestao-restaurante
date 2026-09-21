import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  assinarSessao, lerSessao, sessaoValida, acharUsuario,
  lerCookies, montarCookieSessao, cookieDeSaida, ehHttps, autorizarDados,
  COOKIE_SESSAO, SESSAO_HORAS,
} from './auth.js';

const SEG = 'segredo-de-teste-nao-usado-em-producao';

describe('a sessão assinada', () => {
  test('ida e volta devolve o mesmo dono', () => {
    const v = assinarSessao({ label: 'Administrativo', role: 'admin', em: Date.now() }, SEG);
    const p = lerSessao(v, SEG);
    assert.equal(p.label, 'Administrativo');
    assert.equal(p.role, 'admin');
  });

  test('cookie mexido não vale', () => {
    const v = assinarSessao({ label: 'Op', role: 'op', em: Date.now() }, SEG);
    const [corpo, mac] = v.split('.');
    // Trocar o corpo (virar admin) sem saber o segredo não passa.
    const forjado = Buffer.from(JSON.stringify({ label: 'Op', role: 'admin', em: Date.now() }), 'utf-8').toString('base64url');
    assert.equal(lerSessao(`${forjado}.${mac}`, SEG), null);
    // Mexer no MAC também não.
    assert.equal(lerSessao(`${corpo}.${mac.slice(0, -1)}x`, SEG), null);
    // Nem assinar com outro segredo.
    assert.equal(lerSessao(assinarSessao({ role: 'admin', em: Date.now() }, 'outro'), SEG), null);
  });

  test('sem segredo não assina nem lê — nunca "passa direto"', () => {
    // ⚠️ Se a falta do segredo fizesse a leitura devolver um payload, a ausência
    // de configuração viraria acesso liberado.
    assert.equal(assinarSessao({ em: Date.now() }, ''), null);
    assert.equal(lerSessao('qualquer.coisa', ''), null);
  });

  test('cookie sem prazo seria "logado para sempre"', () => {
    const velho = assinarSessao({ role: 'admin', em: Date.now() - (SESSAO_HORAS + 1) * 3600 * 1000 }, SEG);
    assert.equal(lerSessao(velho, SEG), null);
  });

  test('lixo não derruba o leitor', () => {
    for (const x of ['', null, undefined, 'a', 'a.b.c', 'não-base64.xxx']) {
      assert.equal(lerSessao(x, SEG), null);
    }
  });
});

describe('desconectar todos os aparelhos', () => {
  test('sessão anterior ao carimbo é recusada', () => {
    // O botão do admin (§6) deixou de ser um pedido gentil ao cliente.
    const agora = Date.now();
    assert.equal(sessaoValida({ em: agora - 1000 }, agora), false);
    assert.equal(sessaoValida({ em: agora }, agora), true);
    assert.equal(sessaoValida({ em: agora + 1000 }, agora), true);
  });
  test('sem carimbo, toda sessão vale', () => {
    assert.equal(sessaoValida({ em: 1 }, 0), true);
    assert.equal(sessaoValida({ em: 1 }, undefined), true);
  });
  test('sem sessão nunca é válido', () => {
    assert.equal(sessaoValida(null, 0), false);
  });
});

describe('quem é o dono da senha', () => {
  const usuarios = [
    { id: 'u1', nome: 'Op. Lista SEAMA', senha: '1234', role: 'op', empresa: 'SEAMA' },
    { id: 'u2', nome: 'Gerente', senha: 'abc def', role: 'admin' },
  ];

  test('acha no cadastro e devolve a identidade, nunca a senha', () => {
    const r = acharUsuario('1234', { usuarios });
    assert.equal(r.label, 'Op. Lista SEAMA');
    assert.equal(r.empresa, 'SEAMA');
    assert.equal(r.role, 'op');
    assert.equal(r.senha, undefined);
  });

  test('o admin do .env é o pé-de-meia de quando não há cadastro', () => {
    const r = acharUsuario('senha-do-env', { usuarios: [], adminSenha: 'senha-do-env' });
    assert.equal(r.role, 'admin');
    assert.equal(r.fonte, 'env');
  });

  test('o CADASTRO vence o .env quando os dois batem', () => {
    // Quem mantém o cadastro é a pessoa; o env existe para não haver sistema sem
    // entrada possível.
    const r = acharUsuario('1234', { usuarios, adminSenha: '1234' });
    assert.equal(r.fonte, 'cadastro');
    assert.equal(r.role, 'op');
  });

  test('senha errada, vazia ou só espaço não entra', () => {
    for (const x of ['', '   ', null, undefined, '9999', '123']) {
      assert.equal(acharUsuario(x, { usuarios, adminSenha: 'zzz' }), null);
    }
  });

  test('sem cadastro E sem env, ninguém entra', () => {
    // ⚠️ Não existe fallback embutido no código: o antigo `LOGINS` estava no
    // repositório PÚBLICO e no bundle servido ao navegador.
    assert.equal(acharUsuario('172839', { usuarios: [] }), null);
    assert.equal(acharUsuario('1234', {}), null);
  });

  test('usuário com senha ausente ou não-texto é ignorado', () => {
    assert.equal(acharUsuario('1234', { usuarios: [{ nome: 'X' }, { nome: 'Y', senha: 1234 }] }), null);
  });
});

describe('o cookie', () => {
  test('sai HttpOnly, SameSite e com prazo', () => {
    const c = montarCookieSessao('valor');
    assert.match(c, /^app_sessao=valor;/);
    assert.ok(c.includes('HttpOnly'));
    assert.ok(c.includes('SameSite=Lax'));
    assert.ok(c.includes('Path=/'));
    assert.ok(c.includes(`Max-Age=${SESSAO_HORAS * 3600}`));
  });

  test('Secure só quando a requisição é https', () => {
    // ⚠️ Fixo em true, o login falharia num acesso HTTP direto sem dizer por quê.
    assert.ok(montarCookieSessao('v', { https: true }).includes('Secure'));
    assert.ok(!montarCookieSessao('v', { https: false }).includes('Secure'));
  });

  test('o de saída expira na hora', () => {
    assert.ok(cookieDeSaida().includes('Max-Age=0'));
  });

  test('lê o cabeçalho com espaço, valor escapado e lixo no meio', () => {
    const c = lerCookies(`a=1; ${COOKIE_SESSAO}=x%2Ey; lixo ; =nada; b=2`);
    assert.equal(c.a, '1');
    assert.equal(c[COOKIE_SESSAO], 'x.y');
    assert.equal(c.b, '2');
    assert.deepEqual(lerCookies(undefined), {});
  });

  test('o protocolo vem do proxy, e do socket quando não há proxy', () => {
    assert.equal(ehHttps({ headers: { 'x-forwarded-proto': 'https' } }), true);
    assert.equal(ehHttps({ headers: { 'x-forwarded-proto': 'https, http' } }), true);
    assert.equal(ehHttps({ headers: { 'x-forwarded-proto': 'http' } }), false);
    assert.equal(ehHttps({ headers: {}, socket: { encrypted: true } }), true);
    assert.equal(ehHttps({ headers: {} }), false);
  });
});

describe('a porta dos dados', () => {
  const cookieDe = (payload) => `${COOKIE_SESSAO}=${encodeURIComponent(assinarSessao(payload, SEG))}`;

  test('sessão válida entra', () => {
    const r = autorizarDados({ headers: { cookie: cookieDe({ role: 'op', em: Date.now() }) } }, { secret: SEG });
    assert.equal(r.ok, true);
    assert.equal(r.via, 'sessao');
  });

  test('sem cookie NÃO entra — era o buraco', () => {
    // Antes de 21/09/2026 esta chamada devolvia o banco inteiro.
    const r = autorizarDados({ headers: {} }, { secret: SEG });
    assert.equal(r.ok, false);
  });

  test('o agente do caixa continua entrando pelo segredo de serviço', () => {
    // ⚠️ Os agentes não têm navegador para guardar cookie: exigir sessão deles
    // cortaria a ponte do caixa sem ninguém ligar uma coisa à outra.
    const r = autorizarDados({ headers: { 'x-service-secret': 'sss' } }, { secret: SEG, serviceSecret: 'sss' });
    assert.equal(r.ok, true);
    assert.equal(r.via, 'servico');
  });

  test('segredo de serviço errado não entra', () => {
    assert.equal(autorizarDados({ headers: { 'x-service-secret': 'errado' } }, { secret: SEG, serviceSecret: 'sss' }).ok, false);
    // E segredo de serviço vazio no servidor não vira "qualquer um passa".
    assert.equal(autorizarDados({ headers: { 'x-service-secret': '' } }, { secret: SEG, serviceSecret: '' }).ok, false);
  });

  test('sessão revogada pelo admin não entra', () => {
    const agora = Date.now();
    const r = autorizarDados({ headers: { cookie: cookieDe({ role: 'admin', em: agora - 5000 }) } },
      { secret: SEG, sessoesValidasApos: agora });
    assert.equal(r.ok, false);
    assert.equal(r.motivo, 'sessão revogada');
  });
});
