const pool = require('../db/pool');

// Baixa e devolução de estoque num lugar só.
//
// A Confraria tem quatro caminhos que criam item de venda (comanda, balcão,
// pedido do site, pedido do PDV) e dois que removem. Espalhar a regra por
// esses seis pontos garante que um deles fique para trás numa mudança futura —
// foi exatamente assim que a ponte de compras do Gestão ficou um mês e meio
// sem o caminho "mover entre empresas".
//
// Decisão do dono: a baixa acontece no MOMENTO DO PEDIDO, não no fechamento da
// comanda. A lata sai da geladeira quando o cliente pega; se o estoque só
// baixasse ao fechar a conta, ele mentiria durante todo o expediente —
// justamente no horário de pico, quando saber se ainda tem é o que importa.
//
// Só produtos marcados como revenda (track_stock) são afetados. O saldo pode
// ficar negativo de propósito: travar a venda porque o cadastro está
// desatualizado seria pior que registrar a inconsistência.

async function moverEstoque(itens, { tipo, motivo, orderId, comandaId, userId, sinal }) {
  const lista = (itens || [])
    .map((i) => ({ id: i.product_id, qtd: Math.abs(parseFloat(i.quantity) || 0) }))
    .filter((i) => i.id && i.qtd > 0);
  if (!lista.length) return [];

  // Agrupa por produto: dois itens do mesmo refrigerante na mesma comanda
  // viram um movimento só, em vez de dois com saldos intermediários.
  const porProduto = {};
  lista.forEach((i) => { porProduto[i.id] = (porProduto[i.id] || 0) + i.qtd; });

  const feitos = [];
  for (const [productId, qtd] of Object.entries(porProduto)) {
    try {
      const r = await pool.query(
        `UPDATE products SET stock_qty = stock_qty ${sinal < 0 ? '-' : '+'} ${qtd}
          WHERE id = $1 AND track_stock = true RETURNING stock_qty, name`,
        [productId]
      );
      if (!r.rows[0]) continue; // não é produto de revenda: nada a fazer

      const saldo = parseFloat(r.rows[0].stock_qty);
      await pool.query(
        `INSERT INTO stock_movements (product_id, type, quantity, balance_after, reason, order_id, comanda_id, created_by)
         VALUES ($1, $2, ${sinal * qtd}, ${saldo}, $3, $4, $5, $6) RETURNING id`,
        [productId, tipo, motivo || null, orderId || null, comandaId || null, userId || null]
      );
      feitos.push({ product_id: productId, produto: r.rows[0].name, quantidade: sinal * qtd, saldo });
    } catch (e) {
      // Estoque nunca pode derrubar uma venda. O pedido já foi aceito e o
      // cliente está esperando; um erro aqui vira log, não erro na tela.
      console.error('[stock] falha ao movimentar produto', productId, e.message);
    }
  }
  return feitos;
}

const baixarEstoque   = (itens, ctx) => moverEstoque(itens, { ...ctx, tipo: 'venda',   sinal: -1 });
const devolverEstoque = (itens, ctx) => moverEstoque(itens, { ...ctx, tipo: 'estorno', sinal: +1 });

module.exports = { baixarEstoque, devolverEstoque, moverEstoque };
