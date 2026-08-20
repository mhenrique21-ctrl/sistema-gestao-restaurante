const pool = require('../db/pool');

// Fechamento mensal do fiado de colaborador.
//
// No fim do mês o que o colaborador consumiu vira desconto na folha. Isso já
// existe na Gestão como "consumação" e já entra no holerite — hoje digitado à
// mão. Aqui o PDV passa a alimentar.
//
// Não é um cron marcado pra 00:05 do dia 1º de propósito. Cron que dispara uma
// vez perde o mês inteiro, em silêncio, se o servidor estiver reiniciando
// naquele minuto. O laço abaixo pergunta "existe mês vencido sem fechar?" de
// hora em hora: se passou, ele fecha na próxima volta.

function mesAnterior(hoje = new Date()) {
  // Em Belém, não em UTC: depois das 21h local já é o dia seguinte em UTC, e no
  // dia 1º isso faria o serviço achar que ainda é o mês passado.
  const s = hoje.toLocaleDateString('en-CA', { timeZone: 'America/Belem' });
  const [ano, mes] = s.split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function ultimoInstanteDoMes(ref) {
  const [ano, mes] = ref.split('-').map(Number);
  // Primeiro instante do mês seguinte, em Belém (UTC-3).
  return `${mes === 12 ? ano + 1 : ano}-${String(mes === 12 ? 1 : mes + 1).padStart(2, '0')}-01T03:00:00Z`;
}

// Quem tem saldo devedor no fim do mês de referência. O valor é o SALDO, não o
// consumo: se a pessoa pagou parte em dinheiro durante o mês, só o que sobrou
// deve ir pra folha.
async function pendentes(ref) {
  const corte = ultimoInstanteDoMes(ref);
  const r = await pool.query(
    `SELECT c.id, c.name, c.funcionario_gestao_id,
            COALESCE(SUM(e.amount) FILTER (WHERE e.created_at < $2), 0) AS saldo
       FROM customers c
       LEFT JOIN credit_entries e ON e.customer_id = c.id
      WHERE c.tipo = 'colaborador' AND c.active = true
        AND NOT EXISTS (
          SELECT 1 FROM credit_entries f
           WHERE f.customer_id = c.id AND f.tipo = 'fechamento_folha' AND f.ref_mes = $1
        )
      GROUP BY c.id, c.name, c.funcionario_gestao_id
     HAVING COALESCE(SUM(e.amount) FILTER (WHERE e.created_at < $2), 0) > 0`,
    [ref, corte]
  );
  return r.rows.map((x) => ({ ...x, saldo: parseFloat(x.saldo) }));
}

// Manda a consumação pra Gestão. Se a Gestão estiver fora do ar, NÃO fecha o
// mês aqui — assim a próxima volta do laço tenta de novo. Fechar sem enviar
// zeraria o saldo da pessoa sem gerar desconto nenhum: o consumo sumiria.
async function enviarParaGestao(pessoa, ref, valor) {
  const base = process.env.GESTAO_URL;
  const secret = process.env.SEAMA_SERVICE_SECRET;
  if (!base || !secret) return { ok: false, motivo: 'Integração com a Gestão não configurada (GESTAO_URL / SEAMA_SERVICE_SECRET)' };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/api/consumacao-pdv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-service-secret': secret },
      body: JSON.stringify({
        empresa: 'CONFRARIA',
        funcionarioId: pessoa.funcionario_gestao_id || null,
        nome: pessoa.name,
        mes: ref,
        valor,
        descricao: `Fiado do PDV — ${ref}`,
      }),
      signal: ctrl.signal,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, motivo: d.error || `Gestão respondeu ${r.status}` };
    return { ok: true, funcionario: d.funcionario };
  } catch (e) {
    return { ok: false, motivo: e.name === 'AbortError' ? 'Gestão não respondeu em 15s' : e.message };
  } finally {
    clearTimeout(t);
  }
}

async function fecharMes(ref, { userId = null } = {}) {
  const lista = await pendentes(ref);
  const feitos = [], falhas = [];

  for (const p of lista) {
    const envio = await enviarParaGestao(p, ref, p.saldo);
    if (!envio.ok) { falhas.push({ nome: p.name, valor: p.saldo, motivo: envio.motivo }); continue; }
    try {
      // Zera o saldo só depois de a Gestão ter aceitado. O índice único em
      // (customer_id, ref_mes) é a trava final contra lançamento duplicado.
      await pool.query(
        `WITH atual AS (
           SELECT COALESCE(SUM(amount), 0) AS saldo FROM credit_entries WHERE customer_id = $1
         )
         INSERT INTO credit_entries
           (customer_id, tipo, amount, balance_after, ref_mes, description, created_by)
         SELECT $1, 'fechamento_folha', $2, atual.saldo + $2, $3, $4, $5 FROM atual
         RETURNING id`,
        [p.id, -p.saldo, ref, `Descontado na folha de ${ref}`, userId]
      );
      feitos.push({ nome: p.name, valor: p.saldo, funcionario: envio.funcionario });
    } catch (e) {
      // 23505 = já existia. Duas execuções se cruzaram; a Gestão trata reenvio
      // do mesmo mês como atualização, então não gerou desconto dobrado.
      if (e.code === '23505') continue;
      falhas.push({ nome: p.name, valor: p.saldo, motivo: e.message });
    }
  }
  return { ref, feitos, falhas, pendentes: lista.length };
}

// Roda de hora em hora. Só age quando existe mês vencido com alguém devendo —
// nas outras 700 e poucas voltas do mês não faz nada além de uma consulta.
let rodando = false;
async function tentarFecharMesVencido() {
  if (rodando) return;
  rodando = true;
  try {
    const ref = mesAnterior();
    const lista = await pendentes(ref);
    if (!lista.length) return;
    const res = await fecharMes(ref);
    if (res.feitos.length) {
      console.log(`[fiado/folha] ${ref}: ${res.feitos.length} colaborador(es) fechado(s)`,
        res.feitos.map((f) => `${f.nome} R$ ${f.valor.toFixed(2)}`).join(', '));
    }
    if (res.falhas.length) {
      console.error(`[fiado/folha] ${ref}: ${res.falhas.length} falha(s) — vai tentar de novo na próxima hora`,
        res.falhas.map((f) => `${f.nome}: ${f.motivo}`).join(' | '));
    }
  } catch (e) {
    console.error('[fiado/folha] erro no laço', e.message);
  } finally {
    rodando = false;
  }
}

function iniciarFechamentoAutomatico() {
  const UMA_HORA = 60 * 60 * 1000;
  // Espera 1 min pra não competir com a subida do processo.
  setTimeout(tentarFecharMesVencido, 60 * 1000);
  const timer = setInterval(tentarFecharMesVencido, UMA_HORA);
  timer.unref?.();
  console.log('[fiado/folha] fechamento mensal automático ativo (verifica a cada hora)');
}

module.exports = { mesAnterior, pendentes, fecharMes, tentarFecharMesVencido, iniciarFechamentoAutomatico };
