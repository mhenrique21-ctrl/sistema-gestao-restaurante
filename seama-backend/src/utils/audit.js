const pool = require('../db/pool');

// Grava uma linha em audit_log — nunca deve derrubar a ação principal se
// falhar, então engole o próprio erro (só loga no console).
async function logAction(userId, action, details) {
  try {
    const detailsJson = details && typeof details === 'object' ? JSON.stringify(details) : null;
    await pool.query(
      `INSERT INTO audit_log (user_id, action, details) VALUES ($1, $2, $3::jsonb) RETURNING id`,
      [userId || null, action, detailsJson]
    );
  } catch (err) {
    console.error('[audit/logAction]', err.message);
  }
}

module.exports = { logAction };
