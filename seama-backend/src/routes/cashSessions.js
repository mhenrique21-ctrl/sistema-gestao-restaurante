const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole, podeMovimentarCaixa } = require('../middleware/auth');
const { internalError } = require('../utils/errors');
const { logAction } = require('../utils/audit');
const { enviarSangria } = require('../services/gestaoSync');
const { todayBelem } = require('../utils/date');

router.use(authMiddleware);

const SALE_METHODS = ['dinheiro', 'cartao_debito', 'cartao_credito', 'pix', 'vale_alimentacao', 'vale_refeicao'];

// Resumo de um turno: vendas por forma de pagamento, movimentações e quanto
// deveria haver na gaveta. Só dinheiro passa pela gaveta — cartão e PIX entram
// no faturamento mas não no valor físico a conferir.
async function loadSessionSummary(sessionId) {
  const byMethod = await pool.query(
    `SELECT sp.method, COALESCE(SUM(sp.amount), 0) AS total, COUNT(DISTINCT s.id) AS vendas
     FROM sale_payments sp
     JOIN sales s ON s.id = sp.sale_id
     WHERE s.session_id = $1 AND s.status = 'concluida'
     GROUP BY sp.method`,
    [sessionId]
  );
  const movements = await pool.query(
    `SELECT cm.id, cm.type, cm.amount, cm.reason, cm.category, cm.created_at, u.username AS created_by_name
     FROM cash_movements cm
     LEFT JOIN users u ON u.id = cm.created_by
     WHERE cm.session_id = $1
     ORDER BY cm.created_at ASC`,
    [sessionId]
  );
  const byOperator = await pool.query(
    `SELECT u.username, COUNT(*) AS vendas, COALESCE(SUM(s.total), 0) AS total
     FROM sales s JOIN users u ON u.id = s.user_id
     WHERE s.session_id = $1 AND s.status = 'concluida'
     GROUP BY u.username ORDER BY total DESC`,
    [sessionId]
  );

  const sales = {};
  for (const m of SALE_METHODS) sales[m] = { total: 0, vendas: 0 };
  let totalVendido = 0;
  for (const row of byMethod.rows) {
    const total = parseFloat(row.total);
    if (sales[row.method]) sales[row.method] = { total, vendas: parseInt(row.vendas, 10) };
    totalVendido += total;
  }

  let sangrias = 0;
  let suprimentos = 0;
  for (const m of movements.rows) {
    if (m.type === 'sangria') sangrias += parseFloat(m.amount);
    if (m.type === 'suprimento') suprimentos += parseFloat(m.amount);
  }

  return {
    sales,
    totalVendido,
    sangrias,
    suprimentos,
    movements: movements.rows,
    byOperator: byOperator.rows.map((r) => ({
      username: r.username, vendas: parseInt(r.vendas, 10), total: parseFloat(r.total),
    })),
  };
}

function expectedInDrawer(session, summary) {
  return parseFloat(session.opening_amount)
    + summary.sales.dinheiro.total
    + summary.suprimentos
    - summary.sangrias;
}

// GET /api/cash-sessions/current — turno aberto (ou null) com o resumo
router.get('/current', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT cs.*, u.username AS opened_by_name
       FROM cash_sessions cs LEFT JOIN users u ON u.id = cs.opened_by
       WHERE cs.status = 'aberto' LIMIT 1`
    );
    const session = r.rows[0];
    if (!session) return res.json({ session: null });
    const summary = await loadSessionSummary(session.id);
    res.json({ session, ...summary, expected: expectedInDrawer(session, summary) });
  } catch (err) {
    return internalError(res, err, '[cash-sessions/current]');
  }
});

// POST /api/cash-sessions/open — abre o turno
router.post('/open', async (req, res) => {
  const amount = parseFloat(req.body.opening_amount);
  if (!(amount >= 0)) return res.status(400).json({ error: 'Informe o fundo de troco' });
  try {
    const existing = await pool.query(`SELECT id FROM cash_sessions WHERE status = 'aberto' LIMIT 1`);
    if (existing.rows.length) return res.status(400).json({ error: 'Já existe um caixa aberto' });

    const r = await pool.query(
      `INSERT INTO cash_sessions (opened_by, opening_amount) VALUES ($1, $2) RETURNING *`,
      [req.user.id, amount]
    );
    const session = r.rows[0];
    // A abertura também vira movimentação, pra aparecer no extrato do turno.
    await pool.query(
      `INSERT INTO cash_movements (type, amount, reason, created_by, session_id)
       VALUES ('abertura', $1, 'Fundo de troco', $2, $3) RETURNING id`,
      [amount, req.user.id, session.id]
    );
    logAction(req.user.id, 'caixa_aberto', { session_id: session.id, opening_amount: amount });
    res.status(201).json(session);
  } catch (err) {
    // A trava de turno único também existe como índice no banco.
    if (String(err.message || '').includes('one_open_cash_session')) {
      return res.status(400).json({ error: 'Já existe um caixa aberto' });
    }
    return internalError(res, err, '[cash-sessions/open]');
  }
});

// POST /api/cash-sessions/movement — sangria ou suprimento. Gerente e admin
// podem pelo perfil; caixa só se o dono tiver marcado a permissão no cadastro.
router.post('/movement', async (req, res) => {
  const { type } = req.body;
  const reason = (req.body.reason || '').trim();
  const amount = parseFloat(req.body.amount);
  // Categoria é opcional: sangria pra depósito no cofre ou troco não é
  // despesa nenhuma e não deve virar conta na Gestão. Só quando o operador
  // escolhe uma categoria (pagamento real feito com o dinheiro da gaveta) é
  // que a sangria sincroniza pra Financeiro > Contas.
  const category = (req.body.category || '').trim();
  if (!['sangria', 'suprimento'].includes(type)) return res.status(400).json({ error: 'Tipo inválido' });
  if (!(amount > 0)) return res.status(400).json({ error: 'Valor inválido' });

  if (!podeMovimentarCaixa(req.user, type)) {
    return res.status(403).json({
      error: type === 'sangria'
        ? 'Você não tem permissão para registrar sangria. Peça a um gerente.'
        : 'Você não tem permissão para registrar suprimento. Peça a um gerente.',
    });
  }
  // Motivo obrigatório em sangria. Dinheiro saindo da gaveta sem justificativa
  // escrita é exatamente o registro que não responde nada numa conferência.
  if (type === 'sangria' && !reason) {
    return res.status(400).json({ error: 'Informe o motivo da sangria (ex: levado ao cofre, pagamento de fornecedor)' });
  }
  // Teto por sangria de quem opera com permissão delegada. Sem ele, "pode fazer
  // sangria" e "pode esvaziar a gaveta" viram a mesma coisa.
  const delegado = req.user.role !== 'gerente' && req.user.role !== 'admin';
  if (type === 'sangria' && delegado && req.user.sangria_limit != null && amount > req.user.sangria_limit) {
    return res.status(403).json({
      error: `Sua sangria é limitada a R$ ${req.user.sangria_limit.toFixed(2).replace('.', ',')} por vez. Para um valor maior, chame um gerente.`,
    });
  }

  try {
    const s = await pool.query(`SELECT * FROM cash_sessions WHERE status = 'aberto' LIMIT 1`);
    const session = s.rows[0];
    if (!session) return res.status(400).json({ error: 'Nenhum caixa aberto' });

    // Sangria maior que o dinheiro em gaveta deixaria o esperado negativo —
    // sinal de erro de digitação, não de operação real.
    if (type === 'sangria') {
      const summary = await loadSessionSummary(session.id);
      const disponivel = expectedInDrawer(session, summary);
      if (amount > disponivel) {
        return res.status(400).json({ error: `Sangria maior que o dinheiro em caixa (${disponivel.toFixed(2)})` });
      }
    }

    const r = await pool.query(
      `INSERT INTO cash_movements (type, amount, reason, created_by, session_id, category)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [type, amount, reason || null, req.user.id, session.id, type === 'sangria' ? (category || null) : null]
    );
    logAction(req.user.id, type, { session_id: session.id, amount, reason: reason || null, category: category || null });
    res.status(201).json(r.rows[0]);
    // Dispara depois de responder: o operador não espera a viagem até a
    // Gestão pra ver a sangria confirmada na tela. Erro aqui só vai pro log.
    if (type === 'sangria' && category) {
      enviarSangria({ movimentoId: r.rows[0].id, categoria: category, valor: amount, motivo: reason || null, data: todayBelem() })
        .catch((e) => console.error('[cash-sessions/movement] erro ao sincronizar sangria com a Gestão:', e.message));
    }
  } catch (err) {
    return internalError(res, err, '[cash-sessions/movement]');
  }
});

// Lê as regras de fechamento configuradas em Config → Fechamento, com
// default seguro pra quem nunca abriu essa aba (nenhuma chave gravada ainda).
async function loadFechamentoSettings() {
  const r = await pool.query(
    `SELECT key, value FROM settings WHERE key IN (
      'fechamento_tolerancia','fechamento_maquina1_nome','fechamento_maquina2_nome',
      'fechamento_obs_obrigatoria','fechamento_limite_aprovacao',
      'fechamento_maquinas_obrigatorio','fechamento_pix_somado'
    )`
  );
  const cfg = {};
  for (const row of r.rows) cfg[row.key] = row.value;
  return {
    tolerancia: Math.max(parseFloat(cfg.fechamento_tolerancia) || 0, 0.005),
    maquina1Nome: cfg.fechamento_maquina1_nome || 'Máquina 1',
    maquina2Nome: cfg.fechamento_maquina2_nome || 'Máquina 2',
    obsObrigatoria: cfg.fechamento_obs_obrigatoria === 'true',
    limiteAprovacao: cfg.fechamento_limite_aprovacao ? parseFloat(cfg.fechamento_limite_aprovacao) : null,
    // Ambos com default true — precisam da chave explicitamente 'false' pra
    // desligar, senão configuração nunca gravada mudaria o comportamento atual.
    maquinasObrigatorio: cfg.fechamento_maquinas_obrigatorio !== 'false',
    pixSomado: cfg.fechamento_pix_somado !== 'false',
  };
}

// POST /api/cash-sessions/close — fecha conferindo o dinheiro contado e,
// conforme configurado em Fechamento, as maquininhas de cartão.
router.post('/close', async (req, res) => {
  const counted = parseFloat(req.body.counted_amount);
  if (!(counted >= 0)) return res.status(400).json({ error: 'Informe o valor contado' });

  try {
    const cfg = await loadFechamentoSettings();

    // "Preenchido" é o campo ter vindo no corpo, não o valor ser > 0 — a
    // máquina pode legitimamente ter batido zero no turno.
    const m1raw = req.body.machine1_amount;
    const m2raw = req.body.machine2_amount;
    const hasM1 = m1raw !== undefined && m1raw !== null && m1raw !== '';
    const hasM2 = m2raw !== undefined && m2raw !== null && m2raw !== '';
    if (cfg.maquinasObrigatorio && !hasM1 && !hasM2) {
      return res.status(400).json({ error: 'Informe o total de pelo menos uma das duas máquinas' });
    }
    const machine1Amount = hasM1 ? parseFloat(m1raw) : null;
    const machine2Amount = hasM2 ? parseFloat(m2raw) : null;
    if ((hasM1 && !(machine1Amount >= 0)) || (hasM2 && !(machine2Amount >= 0))) {
      return res.status(400).json({ error: 'Valor de máquina inválido' });
    }

    const s = await pool.query(`SELECT * FROM cash_sessions WHERE status = 'aberto' LIMIT 1`);
    const session = s.rows[0];
    if (!session) return res.status(400).json({ error: 'Nenhum caixa aberto' });

    const summary = await loadSessionSummary(session.id);
    const expected = expectedInDrawer(session, summary);
    const difference = counted - expected;

    // Cartão (+ PIX, se a configuração mantiver os dois juntos — as duas
    // maquininhas costumam passar PIX também). Nada disso passa pela gaveta.
    const temMaquina = hasM1 || hasM2;
    const cardExpected = summary.sales.cartao_debito.total + summary.sales.cartao_credito.total
      + (cfg.pixSomado ? summary.sales.pix.total : 0);
    const cardInformed = (machine1Amount || 0) + (machine2Amount || 0);
    const cardDifference = temMaquina ? cardInformed - cardExpected : 0;

    const foraDaTolerancia = Math.abs(difference) > cfg.tolerancia || (temMaquina && Math.abs(cardDifference) > cfg.tolerancia);
    if (cfg.obsObrigatoria && foraDaTolerancia && !(req.body.notes || '').trim()) {
      return res.status(400).json({ error: 'Há diferença no fechamento — informe uma observação explicando o motivo.' });
    }
    const delegado = !['admin', 'gerente'].includes(req.user.role);
    if (delegado && cfg.limiteAprovacao != null
      && (Math.abs(difference) > cfg.limiteAprovacao || (temMaquina && Math.abs(cardDifference) > cfg.limiteAprovacao))) {
      return res.status(403).json({ error: `Diferença acima de ${cfg.limiteAprovacao.toFixed(2)} — peça a um gerente ou admin pra fechar.` });
    }

    const r = await pool.query(
      `UPDATE cash_sessions
       SET status = 'fechado', closed_at = NOW(), closed_by = $1,
           counted_amount = $2, expected_amount = $3, difference = $4, notes = $5,
           machine1_amount = $6, machine2_amount = $7
       WHERE id = $8 RETURNING *`,
      [req.user.id, counted, expected, difference, req.body.notes || null, machine1Amount, machine2Amount, session.id]
    );
    logAction(req.user.id, 'caixa_fechado', {
      session_id: session.id, expected, counted, difference, cardExpected, cardInformed, cardDifference,
    });

    // Faturamento do dia sobe pro App Gestão, que é onde vive a DRE. Depois de
    // o turno já estar fechado no banco e nunca com await no caminho de erro:
    // se o Gestão estiver fora do ar, o dia fica na fila e vai no próximo
    // fechamento. Travar o fechamento do caixa por causa de integração seria
    // deixar a loja parada por um problema que não é dela.
    const gestaoSync = require('../services/gestaoSync');
    const sync = await gestaoSync.aoFecharCaixa(gestaoSync.hojeBelem());

    res.json({
      session: r.rows[0], ...summary, expected, counted, difference,
      machine1Amount, machine2Amount,
      cardExpected: temMaquina ? cardExpected : null, cardInformed: temMaquina ? cardInformed : null,
      cardDifference: temMaquina ? cardDifference : null,
      totalGeral: summary.totalVendido,
      tolerancia: cfg.tolerancia, maquina1Nome: cfg.maquina1Nome, maquina2Nome: cfg.maquina2Nome,
      gestao: sync,
    });
  } catch (err) {
    return internalError(res, err, '[cash-sessions/close]');
  }
});

// GET /api/cash-sessions — turnos anteriores (gerente/admin)
router.get('/', requireRole('gerente', 'admin'), async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
  try {
    const r = await pool.query(
      `SELECT cs.*, uo.username AS opened_by_name, uc.username AS closed_by_name
       FROM cash_sessions cs
       LEFT JOIN users uo ON uo.id = cs.opened_by
       LEFT JOIN users uc ON uc.id = cs.closed_by
       ORDER BY cs.opened_at DESC LIMIT $1`,
      [limit]
    );
    res.json(r.rows);
  } catch (err) {
    return internalError(res, err, '[cash-sessions/list]');
  }
});

// GET /api/cash-sessions/:id — detalhe de um turno (gerente/admin)
router.get('/:id', requireRole('gerente', 'admin'), async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT cs.*, uo.username AS opened_by_name, uc.username AS closed_by_name
       FROM cash_sessions cs
       LEFT JOIN users uo ON uo.id = cs.opened_by
       LEFT JOIN users uc ON uc.id = cs.closed_by
       WHERE cs.id = $1`,
      [req.params.id]
    );
    const session = r.rows[0];
    if (!session) return res.status(404).json({ error: 'Turno não encontrado' });
    const summary = await loadSessionSummary(session.id);
    const expected = session.expected_amount !== null
      ? parseFloat(session.expected_amount)
      : expectedInDrawer(session, summary);
    res.json({ session, ...summary, expected });
  } catch (err) {
    return internalError(res, err, '[cash-sessions/detail]');
  }
});

module.exports = router;
