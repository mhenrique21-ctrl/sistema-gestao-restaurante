const router = require('express').Router();
const pool = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const { internalError } = require('../utils/errors');

// Fiado de clientes e colaboradores.
//
// Qualquer operador pode vender fiado — foi decisão do dono. Como não há limite
// de crédito, o controle não está em barrar a venda: está no rastro. Toda linha
// registra quem lançou, de qual comanda veio e qual era o saldo depois.

router.use(authMiddleware, requireRole('admin', 'atendente'));

const TIPOS = ['cliente', 'colaborador'];

// Saldo é sempre SUM(amount), nunca o balance_after da última linha. Duas
// vendas simultâneas pra mesma pessoa poderiam gravar um balance_after igual;
// somando, o próximo lançamento se corrige sozinho.
const SALDO_SUBQUERY = `
  SELECT customer_id,
         SUM(amount) AS saldo,
         MAX(created_at) FILTER (WHERE tipo = 'consumo') AS ultimo_consumo,
         MAX(created_at) FILTER (WHERE tipo IN ('pagamento', 'fechamento_folha')) AS ultimo_acerto
    FROM credit_entries
   GROUP BY customer_id`;

// GET /api/fiado — quem tem conta de fiado, com saldo e há quanto tempo.
// Sem limite de crédito, o dado que importa não é quanto se deve: é há quanto
// tempo se deve.
router.get('/', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT c.id, c.name, c.phone, c.tipo, c.blocked,
             COALESCE(e.saldo, 0) AS saldo,
             e.ultimo_consumo, e.ultimo_acerto
        FROM customers c
        LEFT JOIN (${SALDO_SUBQUERY}) e ON e.customer_id = c.id
       WHERE c.fiado_ativo = true AND c.active = true
       ORDER BY COALESCE(e.saldo, 0) DESC, c.name`);
    res.json(r.rows);
  } catch (err) {
    return internalError(res, err, '[fiado/GET]');
  }
});

// GET /api/fiado/pessoas?q= — busca pro seletor do fechamento. Devolve o saldo
// junto porque a tela precisa mostrar "já devia" antes de confirmar.
router.get('/pessoas', async (req, res) => {
  const q = String(req.query.q || '').trim();
  try {
    const filtro = q
      ? `AND (c.name ILIKE '%' || $1 || '%' OR c.phone ILIKE '%' || $1 || '%')`
      : '';
    const r = await pool.query(`
      SELECT c.id, c.name, c.phone, c.tipo, c.blocked,
             COALESCE(e.saldo, 0) AS saldo
        FROM customers c
        LEFT JOIN (${SALDO_SUBQUERY}) e ON e.customer_id = c.id
       WHERE c.fiado_ativo = true AND c.active = true ${filtro}
       ORDER BY c.name
       LIMIT 30`, q ? [q] : []);
    res.json(r.rows);
  } catch (err) {
    return internalError(res, err, '[fiado/pessoas]');
  }
});

// POST /api/fiado/pessoas — habilita fiado. Aceita tanto cadastrar alguém novo
// quanto ligar o fiado de um cliente que já existe no delivery: o cadastro é um
// só, e obrigar a redigitar quem já está lá geraria duas fichas da mesma pessoa.
router.post('/pessoas', async (req, res) => {
  const { name, phone, tipo, cpf, funcionario_gestao_id, customer_id } = req.body;
  if (tipo && !TIPOS.includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' });

  try {
    if (customer_id) {
      const r = await pool.query(
        `UPDATE customers SET fiado_ativo = TRUE, tipo = $1, cpf = COALESCE($2, cpf),
                funcionario_gestao_id = COALESCE($3, funcionario_gestao_id)
          WHERE id = $4
          RETURNING id, name, phone, tipo, fiado_ativo`,
        [tipo || 'cliente', cpf || null, funcionario_gestao_id || null, customer_id]
      );
      if (!r.rows[0]) return res.status(404).json({ error: 'Cliente não encontrado' });
      return res.json(r.rows[0]);
    }

    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Informe o nome' });
    const fone = String(phone || '').replace(/\D/g, '');
    if (!fone) return res.status(400).json({ error: 'Informe o telefone' });

    // O telefone é único em customers: se a pessoa já existe (comprou no
    // delivery uma vez), liga o fiado nela em vez de estourar duplicidade.
    const r = await pool.query(
      `INSERT INTO customers (name, phone, tipo, cpf, funcionario_gestao_id, fiado_ativo)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       ON CONFLICT (phone) DO UPDATE
          SET fiado_ativo = TRUE, tipo = EXCLUDED.tipo,
              cpf = COALESCE(EXCLUDED.cpf, customers.cpf),
              funcionario_gestao_id = COALESCE(EXCLUDED.funcionario_gestao_id, customers.funcionario_gestao_id)
       RETURNING id, name, phone, tipo, fiado_ativo`,
      [String(name).trim(), fone, tipo || 'cliente', cpf || null, funcionario_gestao_id || null]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    return internalError(res, err, '[fiado/pessoas POST]');
  }
});

router.patch('/pessoas/:id', async (req, res) => {
  const campos = [];
  const valores = [];
  let i = 1;
  for (const c of ['name', 'phone', 'cpf', 'funcionario_gestao_id']) {
    if (req.body[c] !== undefined) {
      campos.push(`${c} = $${i++}`);
      valores.push(c === 'phone' ? String(req.body[c]).replace(/\D/g, '') : (req.body[c] || null));
    }
  }
  if (req.body.tipo !== undefined) {
    if (!TIPOS.includes(req.body.tipo)) return res.status(400).json({ error: 'Tipo inválido' });
    campos.push(`tipo = $${i++}`);
    valores.push(req.body.tipo);
  }
  // Booleano como literal: o wrapper do pool troca $N por texto.
  if (req.body.fiado_ativo !== undefined) campos.push(`fiado_ativo = ${req.body.fiado_ativo ? 'TRUE' : 'FALSE'}`);
  if (req.body.blocked !== undefined) campos.push(`blocked = ${req.body.blocked ? 'TRUE' : 'FALSE'}`);
  if (!campos.length) return res.status(400).json({ error: 'Nada para alterar' });

  valores.push(req.params.id);
  try {
    const r = await pool.query(
      `UPDATE customers SET ${campos.join(', ')} WHERE id = $${i}
       RETURNING id, name, phone, tipo, cpf, fiado_ativo, blocked, funcionario_gestao_id`,
      valores
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Pessoa não encontrada' });
    res.json(r.rows[0]);
  } catch (err) {
    return internalError(res, err, '[fiado/pessoas PATCH]');
  }
});

// GET /api/fiado/pessoas/:id/extrato?de=&ate=
// O saldo é acumulado desde sempre; o período filtra só as linhas mostradas.
// Por isso vem também o saldo anterior ao período — sem ele, a coluna de saldo
// da primeira linha não faria sentido.
router.get('/pessoas/:id/extrato', async (req, res) => {
  const de = req.query.de || '1900-01-01';
  const ate = req.query.ate || '2999-12-31';
  try {
    const pessoa = await pool.query(
      `SELECT id, name, phone, tipo, cpf, blocked FROM customers WHERE id = $1`, [req.params.id]
    );
    if (!pessoa.rows[0]) return res.status(404).json({ error: 'Pessoa não encontrada' });

    const linhas = await pool.query(
      `SELECT e.id, e.tipo, e.amount, e.balance_after, e.payment_method, e.description,
              e.created_at, e.comanda_id, u.name AS operador
         FROM credit_entries e
         LEFT JOIN users u ON u.id = e.created_by
        WHERE e.customer_id = $1
          AND DATE(e.created_at AT TIME ZONE 'America/Belem') BETWEEN $2 AND $3
        ORDER BY e.created_at`,
      [req.params.id, de, ate]
    );

    const totais = await pool.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (
           WHERE DATE(created_at AT TIME ZONE 'America/Belem') < $2), 0) AS saldo_anterior,
         COALESCE(SUM(amount), 0) AS saldo_atual,
         COALESCE(SUM(amount) FILTER (
           WHERE tipo = 'consumo'
             AND DATE(created_at AT TIME ZONE 'America/Belem') BETWEEN $2 AND $3), 0) AS consumo_periodo,
         COALESCE(-SUM(amount) FILTER (
           WHERE tipo IN ('pagamento','fechamento_folha')
             AND DATE(created_at AT TIME ZONE 'America/Belem') BETWEEN $2 AND $3), 0) AS pago_periodo
       FROM credit_entries WHERE customer_id = $1`,
      [req.params.id, de, ate]
    );

    res.json({ pessoa: pessoa.rows[0], periodo: { de, ate }, ...totais.rows[0], linhas: linhas.rows });
  } catch (err) {
    return internalError(res, err, '[fiado/extrato]');
  }
});

// POST /api/fiado/pessoas/:id/pagamento — recebe, total ou parcial.
//
// A regra que mais dá errado em PDV: este dinheiro ENTRA na gaveta hoje, mas
// NÃO é faturamento — a receita já foi reconhecida no dia da venda fiada.
// Contar de novo faturaria duas vezes o mesmo café; não contar na gaveta faria
// o fechamento acusar sobra e parecer erro do operador.
router.post('/pessoas/:id/pagamento', async (req, res) => {
  const valor = parseFloat(req.body.amount);
  const metodo = req.body.payment_method;
  const METODOS = ['dinheiro', 'pix', 'cartao_debito', 'cartao_credito'];
  if (!(valor > 0)) return res.status(400).json({ error: 'Informe um valor válido' });
  if (!METODOS.includes(metodo)) return res.status(400).json({ error: 'Forma de pagamento inválida' });

  try {
    const p = await pool.query(`SELECT id, name, tipo FROM customers WHERE id = $1`, [req.params.id]);
    if (!p.rows[0]) return res.status(404).json({ error: 'Pessoa não encontrada' });

    const s = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS saldo FROM credit_entries WHERE customer_id = $1`,
      [req.params.id]
    );
    const saldo = parseFloat(s.rows[0].saldo);
    if (saldo <= 0) return res.status(400).json({ error: `${p.rows[0].name} não tem saldo em aberto` });
    // Receber mais que o devido criaria saldo negativo — crédito na casa, que
    // ninguém pediu e ninguém controla. Parcial é permitido; a mais, não.
    if (valor - saldo > 0.005) {
      return res.status(400).json({
        error: `Valor maior que o saldo em aberto (${saldo.toFixed(2).replace('.', ',')})`,
        saldo,
      });
    }

    // Amarra o recebimento ao turno aberto: é ele que vai explicar o dinheiro
    // a mais na gaveta no fechamento de hoje.
    const turno = await pool.query(`SELECT id FROM cash_sessions WHERE status = 'aberto' LIMIT 1`);

    const linha = await lancar({
      customerId: req.params.id,
      tipo: 'pagamento',
      amount: -valor,
      paymentMethod: metodo,
      sessionId: turno.rows[0]?.id || null,
      description: req.body.description || null,
      userId: req.user?.id || null,
    });

    res.status(201).json({
      lancamento: linha,
      pessoa: p.rows[0],
      saldo_anterior: saldo,
      saldo_restante: Math.round((saldo - valor) * 100) / 100,
      quitado: Math.abs(saldo - valor) < 0.005,
      sem_turno_aberto: !turno.rows[0],
    });
  } catch (err) {
    return internalError(res, err, '[fiado/pagamento]');
  }
});

// Lançamento na razão. Exportado porque quem chama é o fechamento da comanda.
//
// O saldo novo sai de SUM(amount) na mesma instrução do INSERT — não dá pra
// ler o saldo, calcular no Node e gravar depois, porque o pool não tem
// transação de verdade (cada query é uma chamada separada ao Supabase).
async function lancar({ customerId, tipo, amount, comandaId, paymentMethod, sessionId, description, userId }) {
  const r = await pool.query(
    `WITH atual AS (
       SELECT COALESCE(SUM(amount), 0) AS saldo FROM credit_entries WHERE customer_id = $1
     )
     INSERT INTO credit_entries
       (customer_id, tipo, amount, balance_after, comanda_id, payment_method, session_id, description, created_by)
     SELECT $1, $2, $3, atual.saldo + $3, $4, $5, $6, $7, $8 FROM atual
     RETURNING *`,
    [customerId, tipo, amount, comandaId || null, paymentMethod || null, sessionId || null,
     description || null, userId || null]
  );
  return r.rows[0];
}

module.exports = router;
module.exports.lancar = lancar;
