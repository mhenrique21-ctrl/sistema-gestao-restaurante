import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Só em dev: o app roda em localhost:5173, mas a API é a mesma origem do
    // totem.confrariacafe.com. Sem proxy, o navegador bloqueia por CORS.
    // Em produção o build final é servido do próprio domínio, então
    // `${API}` fica vazio (relativo) e isso aqui nem entra em cena.
    proxy: {
      '/api': {
        target: 'https://totem.confrariacafe.com',
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
