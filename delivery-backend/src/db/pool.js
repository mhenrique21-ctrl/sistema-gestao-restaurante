const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { auth: { persistSession: false } }
);

// Wrapper que imita pg.Pool usando a REST API do Supabase
// Permite manter todas as rotas sem reescrita
const pool = {
  supabase,

  async query(sql, params = []) {
    // Substitui $1, $2... pelos valores na query SQL
    let finalSql = sql;
    params.forEach((val, i) => {
      const escaped = val === null ? 'NULL' :
        typeof val === 'boolean' ? (val ? 'TRUE' : 'FALSE') :
        typeof val === 'number' ? val :
        `'${String(val).replace(/'/g, "''")}'`;
      finalSql = finalSql.replace(new RegExp('\\$' + (i + 1), 'g'), escaped);
    });

    const { data, error } = await supabase.rpc('run_sql', { query: finalSql });
    if (error) {
      const err = new Error(error.message);
      err.code = error.code;
      throw err;
    }
    return { rows: Array.isArray(data) ? data : [] };
  },

  async connect() {
    // Retorna client com mesma interface para transações
    return {
      _ops: [],
      async query(sql, params = []) {
        return pool.query(sql, params);
      },
      async release() {},
    };
  },
};

module.exports = pool;
module.exports.pool = pool;
