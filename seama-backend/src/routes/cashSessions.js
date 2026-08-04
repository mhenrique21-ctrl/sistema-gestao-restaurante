const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { internalError } = require('../utils/errors');
const { logAction } = require('../utils/audit');

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
    `SELECT cm.id, cm.type, cm.amount, cm.reason, cm.created_at, u.username AS created_by_name
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

// POST /api/cash-sessions/movement — sangria ou suprimento (gerente/admin)
router.post('/movement', requireRole('gerente', 'admin'), async (req, res) => {
  const { type, reason } = req.body;
  const amount = parseFloat(req.body.amount);
  if (!['sangria', 'suprimento'].includes(type)) return res.status(400).json({ error: 'Tipo inválido' });
  if (!(amount > 0)) return res.status(400).json({ error: 'Valor inválido' });
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
      `INSERT INTO cash_movements (type, amount, reason, created_by, session_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [type, amount, reason || null, req.user.id, session.id]
    );
    logAction(req.user.id, type, { session_id: session.id, amount, reason: reason || null });
    res.status(201).json(r.rows[0]);
  } catch (err) {
    return internalError(res, err, '[cash-sessions/movement]');
  }
});

// POST /api/cash-sessions/close — fecha conferindo o dinheiro contado
router.post('/close', async (req, res) => {
  const counted = parseFloat(req.body.counted_amount);
  if (!(counted >= 0)) return res.status(400).json({ error: 'Informe o valor contado' });
  try {
    const s = await pool.query(`SELECT * FROM cash_sessions WHERE status = 'aberto' LIMIT 1`);
    const session = s.rows[0];
    if (!session) return res.status(400).json({ error: 'Nenhum caixa aberto' });

    const summary = await loadSessionSummary(session.id);
    const expected = expectedInDrawer(session, summary);
    const difference = counted - expected;

    const r = await pool.query(
      `UPDATE cash_sessions
       SET status = 'fechado', closed_at = NOW(), closed_by = $1,
           counted_amount = $2, expected_amount = $3, difference = $4, notes = $5
       WHERE id = $6 RETURNING *`,
      [req.user.id, counted, expected, difference, req.body.notes || null, session.id]
    );
    logAction(req.user.id, 'caixa_fechado', {
      session_id: session.id, expected, counted, difference,
    });

    // Faturamento do dia sobe pro App Gestão, que é onde vive a DRE. Depois de
    // o turno já estar fechado no banco e nunca com await no caminho de erro:
    // se o Gestão estiver fora do ar, o dia fica na fila e vai no próximo
    // fechamento. Travar o fechamento do caixa por causa de integração seria
    // deixar a loja parada por um problema que não é dela.
    const gestaoSync = require('../services/gestaoSync');
    const sync = await gestaoSync.aoFecharCaixa(gestaoSync.hojeBelem());

    res.json({ session: r.rows[0], ...summary, expected, counted, difference, gestao: sync });
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
