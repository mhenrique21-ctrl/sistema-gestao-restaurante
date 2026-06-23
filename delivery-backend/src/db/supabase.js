const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY,
  { auth: { persistSession: false } }
);

// Wrapper que imita a interface do pg.Pool para não reescrever todas as rotas
// Usa supabase.rpc para queries SQL brutas via função postgres
const pool = {
  async query(sql, params = []) {
    // Substitui $1,$2... por valores para enviar via rpc
    const { data, error } = await supabase.rpc('execute_sql', {
      query: sql,
      params: params.map(String),
    });
    if (error) throw new Error(error.message);
    return { rows: data || [] };
  },

  async connect() {
    // Retorna um "client" fake com BEGIN/COMMIT/ROLLBACK emulados
    const ops = [];
    return {
      async query(sql, params = []) {
        ops.push({ sql, params });
        const { data, error } = await supabase.rpc('execute_sql', {
          query: sql,
          params: (params || []).map(String),
        });
        if (error) throw new Error(error.message);
        return { rows: data || [] };
      },
      async release() {},
    };
  },
};

module.exports = { supabase, pool };
