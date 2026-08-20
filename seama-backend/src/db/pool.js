const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const ws = require('ws');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    auth: { persistSession: false },
    realtime: { transport: ws },
  }
);

// Wrapper que imita pg.Pool usando a REST API do Supabase (função run_sql).
// Faz substituição de string pros placeholders $1, $2... — não é parametrização
// real. Por isso: no máximo 9 parâmetros reais por query (acima de $9, o
// regex sem âncora de "$1" também casa dentro de "$10" e corrompe o valor).
// Campos extras devem ser interpolados como literal SQL (ver cashMovements.js
// do delivery-backend da Confraria pro padrão já usado).
const pool = {
  supabase,

  async query(sql, params = []) {
    let finalSql = sql;
    params.forEach((val, i) => {
      const escaped = (val === null || val === undefined) ? 'NULL' :
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
