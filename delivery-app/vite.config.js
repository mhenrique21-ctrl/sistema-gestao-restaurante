import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Confraria Delivery',
        short_name: 'Confraria',
        description: 'Peça seu café, bolo ou salgado favorito',
        theme_color: '#991b1b',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        // Com clientsClaim, este service worker assume TODAS as páginas do
        // domínio — e o navigateFallback padrão responde index.html (o app
        // React) pra qualquer navegação. As páginas abaixo não são rotas do
        // app: são aplicações próprias servidas pelo backend. Sem esta lista,
        // abrir /admin.html devolvia o app do cliente e o React Router
        // avisava "No routes matched" — foi o que deixou a aba Delivery do
        // PDV em branco, já que ela abre /admin.html num iframe. O curl
        // recebia o arquivo certo justamente por não passar pelo SW.
        navigateFallbackDenylist: [
          /^\/admin\.html/, /^\/comanda\.html/, /^\/kiosk\.html/,
          /^\/kitchen\.html/, /^\/retaguarda\.html/, /^\/home\.html/,
          /^\/enderecos\.html/, /^\/emergencia\.html/, /^\/api\//,
        ],
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [{
          urlPattern: /\/api\/menu/,
          handler: 'StaleWhileRevalidate',
          options: { cacheName: 'menu-cache', expiration: { maxAgeSeconds: 300 } },
        }],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/ws': { target: 'ws://localhost:4000', ws: true },
    },
  },
})
