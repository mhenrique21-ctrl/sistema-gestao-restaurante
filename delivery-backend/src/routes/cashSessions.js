const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { getOpenSession, getSessionSummary } = require('../services/cashSummary');

router.use(authMiddleware, requireRole('admin', 'atendente'));

function erro(res, err, tag) {
  console.error(tag, err.message);
  return res.status(500).json({ error: 'Erro interno do servidor' });
}

// Sangria categorizada vira conta paga na Gestão (Financeiro > Contas). Nunca
// deixa a sangria falhar por causa da Gestão fora do ar — só loga e segue.
// movimentoId dá idempotência: reenviar a mesma sangria atualiza em vez de
// duplicar a conta.
async function enviarSangriaParaGestao({ movimentoId, categoria, valor, motivo, data }) {
  const base = process.env.GESTAO_URL;
  const secret = process.env.SEAMA_SERVICE_SECRET;
  if (!base || !secret) { console.error('[cash-sessions/sangria] Integração com a Gestão não configurada'); return; }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/api/sangria-pdv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-service-secret': secret },
      body: JSON.stringify({ empresa: 'CONFRARIA', categoria, valor, motivo, data, movimentoId }),
      signal: ctrl.signal,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) console.error('[cash-sessions/sangria] falha ao enviar pra Gestão:', d.error || r.status);
  } catch (e) {
    console.error('[cash-sessions/sangria] erro ao enviar pra Gestão:', e.message);
  } finally {
    clearTimeout(t);
  }
}

// GET /api/cash-sessions/current — turno aberto + conferência parcial.
router.get('/current', async (req, res) => {
  try {
    const session = await getOpenSession();
    if (!session) return res.json({ session: null });
    const resumo = await getSessionSummary(session);
    res.json({ session, ...resumo });
  } catch (err) {
    return erro(res, err, '[cash-sessions/current]');
  }
});

// POST /api/cash-sessions/open — abre o turno com o fundo de troco.
router.post('/open', async (req, res) => {
  const amount = parseFloat(req.body.opening_amount);
  if (!(amount >= 0)) return res.status(400).json({ error: 'Informe o fundo de troco' });
  try {
    if (await getOpenSession()) return res.status(400).json({ error: 'Já existe um caixa aberto' });

    const r = await pool.query(
      `INSERT INTO cash_sessions (opening_amount, opened_by) VALUES (${amount}, $1) RETURNING *`,
      [req.user.id]
    );
    const session = r.rows[0];
    // A abertura também vira movimento, pra aparecer no extrato do turno.
    await pool.query(
      `INSERT INTO cash_movements (type, amount, reason, created_by, session_id)
       VALUES ('abertura', ${amount}, 'Fundo de troco', $1, $2) RETURNING id`,
      [req.user.id, session.id]
    );
    res.status(201).json(session);
  } catch (err) {
    // O índice parcial one_open_cash_session é a garantia real contra dois
    // turnos abertos: a checagem acima perde a corrida se dois operadores
    // abrirem ao mesmo tempo, o banco não.
    if (err.code === '23505' || String(err.message || '').includes('one_open_cash_session')) {
      return res.status(400).json({ error: 'Já existe um caixa aberto' });
    }
    return erro(res, err, '[cash-sessions/open]');
  }
});

// POST /api/cash-sessions/movement — sangria ou suprimento no turno aberto.
router.post('/movement', async (req, res) => {
  const { type, reason } = req.body;
  const amount = parseFloat(req.body.amount);
  // Opcional: sangria pra cofre/troco não é despesa e não deve virar conta na
  // Gestão. Só sincroniza quando o operador escolhe uma categoria real.
  const category = (req.body.category || '').trim();
  if (!['sangria', 'suprimento'].includes(type)) return res.status(400).json({ error: 'Tipo inválido' });
  if (!(amount > 0)) return res.status(400).json({ error: 'Valor inválido' });
  try {
    const session = await getOpenSession();
    if (!session) return res.status(400).json({ error: 'Nenhum caixa aberto' });

    if (type === 'sangria') {
      const { expected } = await getSessionSummary(session);
      if (amount > expected) {
        return res.status(400).json({ error: `Sangria maior que o dinheiro em caixa (R$ ${expected.toFixed(2)})` });
      }
    }
    const r = await pool.query(
      `INSERT INTO cash_movements (type, amount, reason, created_by, session_id, category)
       VALUES ($1, ${amount}, $2, $3, $4, $5) RETURNING *`,
      [type, reason || null, req.user.id, session.id, type === 'sangria' ? (category || null) : null]
    );
    res.status(201).json(r.rows[0]);
    if (type === 'sangria' && category) {
      enviarSangriaParaGestao({
        movimentoId: r.rows[0].id, categoria: category, valor: amount, motivo: reason || null,
        data: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Belem' }),
      });
    }
  } catch (err) {
    return erro(res, err, '[cash-sessions/movement]');
  }
});

// POST /api/cash-sessions/close — conferência cega: o operador informa o que
// contou e só então vê o esperado e a diferença.
router.post('/close', async (req, res) => {
  const counted = parseFloat(req.body.counted_amount);
  if (!(counted >= 0)) return res.status(400).json({ error: 'Informe o valor contado' });
  try {
    const session = await getOpenSession();
    if (!session) return res.status(400).json({ error: 'Nenhum caixa aberto' });

    const resumo = await getSessionSummary(session);
    const expected = resumo.expected;
    const difference = Math.round((counted - expected) * 100) / 100;

    const r = await pool.query(
      `UPDATE cash_sessions
          SET status = 'fechado', closed_by = $1, closed_at = NOW(),
              counted_amount = ${counted}, expected_amount = ${expected},
              difference = ${difference}, notes = $2
        WHERE id = $3 RETURNING *`,
      [req.user.id, req.body.notes || null, session.id]
    );
    res.json({ session: r.rows[0], ...resumo, expected, counted, difference });
  } catch (err) {
    return erro(res, err, '[cash-sessions/close]');
  }
});

// GET /api/cash-sessions — histórico de turnos fechados.
router.get('/', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT cs.*, ua.name AS opened_by_name, uf.name AS closed_by_name
         FROM cash_sessions cs
         LEFT JOIN users ua ON ua.id = cs.opened_by
         LEFT JOIN users uf ON uf.id = cs.closed_by
        ORDER BY cs.opened_at DESC LIMIT 60`
    );
    res.json(r.rows);
  } catch (err) {
    return erro(res, err, '[cash-sessions/list]');
  }
});

// GET /api/cash-sessions/:id — relatório de um turno (inclusive fechado).
router.get('/:id', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT cs.*, ua.name AS opened_by_name, uf.name AS closed_by_name
         FROM cash_sessions cs
         LEFT JOIN users ua ON ua.id = cs.opened_by
         LEFT JOIN users uf ON uf.id = cs.closed_by
        WHERE cs.id = $1`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Turno não encontrado' });
    const resumo = await getSessionSummary(r.rows[0]);
    res.json({ session: r.rows[0], ...resumo });
  } catch (err) {
    return erro(res, err, '[cash-sessions/get]');
  }
});

module.exports = router;
