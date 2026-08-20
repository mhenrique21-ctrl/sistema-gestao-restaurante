// Resposta de erro padronizada — nunca repassa err.message (do driver, etc)
// direto pro cliente. O detalhe real vai só pro console.error; o cliente
// recebe uma mensagem genérica e segura.
function sendError(res, status, publicMessage, err, logTag) {
  if (err) console.error(logTag || '[error]', err.message, err.code ? `| code: ${err.code}` : '');
  return res.status(status).json({ error: publicMessage });
}

function internalError(res, err, logTag) {
  return sendError(res, 500, 'Erro interno', err, logTag);
}

module.exports = { sendError, internalError };
