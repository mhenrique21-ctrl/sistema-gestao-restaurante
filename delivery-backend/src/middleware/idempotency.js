// Protege endpoints de escrita crítica (criar pedido, iniciar cobrança) contra
// duplo clique ou retry de rede: o cliente manda um header Idempotency-Key
// (um UUID gerado por request); se a mesma chave chegar de novo, devolve a
// resposta já salva em vez de repetir o efeito colateral (pedido/cobrança).
const store = new Map(); // `${method}:${path}:${key}` -> { status, body, expiresAt }
const TTL_MS = 24 * 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store) if (v.expiresAt < now) store.delete(k);
}, 60 * 60 * 1000).unref();

function idempotent(req, res, next) {
  const key = req.headers['idempotency-key'];
  if (!key) return next(); // sem chave, segue sem proteção (opcional pro cliente)

  const cacheKey = `${req.method}:${req.originalUrl}:${key}`;
  const cached = store.get(cacheKey);
  if (cached) {
    res.set('Idempotency-Replayed', 'true');
    return res.status(cached.status).json(cached.body);
  }

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    // só guarda respostas de sucesso — erro 4xx/5xx não deve "travar" o cliente
    // impedindo uma nova tentativa legítima com a mesma chave
    if (res.statusCode < 400) {
      store.set(cacheKey, { status: res.statusCode, body, expiresAt: Date.now() + TTL_MS });
    }
    return originalJson(body);
  };
  next();
}

module.exports = { idempotent };
