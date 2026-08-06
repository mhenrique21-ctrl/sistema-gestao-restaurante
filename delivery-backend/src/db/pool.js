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

// Wrapper que imita pg.Pool usando a REST API do Supabase
// Permite manter todas as rotas sem reescrita
const pool = {
  supabase,

  async query(sql, params = []) {
    // Substitui $1, $2... pelos valores na query SQL.
    //
    // Numa passada só, de propósito. Antes era um replace por parâmetro, em
    // sequência, e isso tinha dois defeitos sérios:
    //
    // 1. O valor já inserido voltava a ser varrido pelas rodadas seguintes. Um
    //    hash bcrypt começa com "$2a$10$" — o "$2" ali dentro virava o valor do
    //    parâmetro 2 e o hash chegava corrompido no banco. Quebrava toda troca
    //    de senha e de PIN.
    // 2. O regex de "$1" casava dentro de "$10", então nada acima de 9
    //    parâmetros funcionava.
    //
    // Varrendo o SQL uma vez e trocando cada marcador pelo valor final, os dois
    // some. \d+ é guloso, então "$10" casa inteiro e não como "$1" + "0".
    const escapar = (val) =>
      (val === null || val === undefined) ? 'NULL' :
      typeof val === 'boolean' ? (val ? 'TRUE' : 'FALSE') :
      typeof val === 'number' ? String(val) :
      `'${String(val).replace(/'/g, "''")}'`;

    const finalSql = sql.replace(/\$(\d+)/g, (marcador, n) => {
      const i = parseInt(n, 10) - 1;
      // Marcador sem valor correspondente fica como está — deixa o Postgres
      // reclamar do parâmetro faltando em vez de gerar SQL silenciosamente
      // diferente do que a rota escreveu.
      return i >= 0 && i < params.length ? escapar(params[i]) : marcador;
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
