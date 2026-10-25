const router = require('express').Router();
const pool = require('../db/pool');
const { internalError } = require('../utils/errors');

function serviceAuth(req, res, next) {
  const secret = process.env.GESTAO_SERVICE_SECRET;
  if (!secret) return res.status(503).json({ error: 'Integração não configurada (GESTAO_SERVICE_SECRET)' });
  if (req.headers['x-service-secret'] !== secret) return res.status(401).json({ error: 'Credencial de serviço inválida' });
  next();
}
const S = (v) => `'${String(v == null ? '' : v).replace(/'/g, "''")}'`;
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// POST /api/vendas-historico — recebe um lote de itens de vendas fechadas do
// Eclética (via Gestão). Idempotente: a chave única (empresa,id_nota,num_item)
// no banco faz o ON CONFLICT ignorar o que já entrou. Reenviar o mesmo lote
// não duplica — igual ao resto da ponte.
router.post('/', serviceAuth, async (req, res) => {
  const empresa = String(req.body.empresa || 'CONFRARIA').toUpperCase();
  const itens = Array.isArray(req.body.itens) ? req.body.itens : [];
  if (!itens.length) return res.status(400).json({ error: 'Informe ao menos um item' });
  try {
    let inseridos = 0;
    const CHUNK = 500;
    for (let i = 0; i < itens.length; i += CHUNK) {
      const vals = itens.slice(i, i + CHUNK).map((it) => {
        const idNota = N(it.id_nota);
        const numItem = N(it.num_item);
        const desc = String(it.descr_item || '').trim();
        const qtde = N(it.qtde);
        const unit = N(it.vlr_unit);
        const total = N(it.vlr_total) || qtde * unit;
        const data = String(it.data_venda || '').replace("'", '');
        const canc = it.cancelada ? 'true' : 'false';
        return `(${S(empresa)},${idNota},${numItem},${S(it.cod_item || '')},${S(desc)},${qtde},${unit},${total},${S(data)}::timestamptz,${canc})`;
      }).join(',');
      const r = await pool.query(
        `INSERT INTO vendas_itens (empresa,id_nota,num_item,cod_item,descr_item,qtde,vlr_unit,vlr_total,data_venda,cancelada)
         VALUES ${vals}
         ON CONFLICT (empresa,id_nota,num_item) DO NOTHING`
      );
      inseridos += r.rowCount || 0;
    }
    res.json({ ok: true, recebidos: itens.length, inseridos });
  } catch (err) {
    return internalError(res, err, '[vendas-historico]');
  }
});

module.exports = router;
