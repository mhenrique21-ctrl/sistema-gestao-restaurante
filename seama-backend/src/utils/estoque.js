const pool = require('../db/pool');

// Corrigir uma quantidade lançada no passado invalida o `balance_after` de
// todos os movimentos POSTERIORES daquele produto — e é ele que permite
// reconstruir o estoque numa data passada e achar onde a conta divergiu.
// Por isso qualquer correção recalcula a corrente inteira do produto.
//
// `mudanca` aceita { id, quantidade } para corrigir uma linha, { id, excluir }
// para tirá-la da conta, ou { porId: { <id>: novaQtd } } para corrigir várias
// de uma vez (usado ao trocar o fator de um vínculo, que atinge N notas).
//
// Importante: quando for excluir, chame ANTES de apagar a linha. O saldo de
// abertura é derivado do primeiro movimento da corrente, e se a linha excluída
// for justamente essa, apagar primeiro faz a abertura absorver a quantidade
// que deveria sumir.
async function recalcularCorrente(productId, mudanca = {}) {
  const r = await pool.query(
    `SELECT id, quantity, balance_after FROM stock_movements
      WHERE product_id = $1 ORDER BY created_at, id`,
    [productId]
  );
  const movs = r.rows.map((m) => ({
    id: m.id,
    quantidade: parseFloat(m.quantity),
    saldoGravado: m.balance_after != null ? parseFloat(m.balance_after) : null,
  }));
  if (!movs.length) return null;

  // O que existia antes do primeiro movimento. Preserva estoque cadastrado
  // direto no produto, sem movimento correspondente.
  const abertura = (movs[0].saldoGravado ?? movs[0].quantidade) - movs[0].quantidade;

  const porId = mudanca.porId || {};
  const finais = [];
  for (const m of movs) {
    if (mudanca.excluir && m.id === mudanca.id) continue;
    if (m.id === mudanca.id && mudanca.quantidade != null) m.quantidade = mudanca.quantidade;
    if (porId[m.id] != null) m.quantidade = porId[m.id];
    finais.push(m);
  }

  // Só grava o que de fato mudou: produto com 200 movimentos não pode virar
  // 200 escritas a cada ajuste de quantidade.
  let saldo = abertura;
  for (const m of finais) {
    saldo += m.quantidade;
    if (m.saldoGravado !== saldo) {
      await pool.query(
        `UPDATE stock_movements SET balance_after = ${saldo}, quantity = ${m.quantidade}
          WHERE id = $1 RETURNING id`,
        [m.id]
      );
    }
  }
  await pool.query(`UPDATE products SET stock_qty = ${saldo} WHERE id = $1 RETURNING id`, [productId]);
  return saldo;
}

// Só o custo da entrada mais recente vale como "último custo" do produto.
async function reancorarUltimoCusto(productId) {
  const r = await pool.query(
    `SELECT unit_cost, created_at FROM stock_movements
      WHERE product_id = $1 AND type = 'entrada' AND unit_cost IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`,
    [productId]
  );
  const ultimo = r.rows[0];
  if (!ultimo) {
    await pool.query(`UPDATE products SET last_cost = NULL, last_cost_at = NULL WHERE id = $1 RETURNING id`, [productId]);
    return null;
  }
  const custo = parseFloat(ultimo.unit_cost);
  await pool.query(
    `UPDATE products SET last_cost = ${custo}, last_cost_at = $2 WHERE id = $1 RETURNING id`,
    [productId, ultimo.created_at]
  );
  return custo;
}

module.exports = { recalcularCorrente, reancorarUltimoCusto };
