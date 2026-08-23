import React from 'react'
import ReactDOM from 'react-dom/client'

const root = ReactDOM.createRoot(document.getElementById('root'))

// /tv/<empresa>: página pública pra TV, sem login e sem carregar o app inteiro
// — import() dinâmico faz a TV baixar só o bundle da CardapioTV, não o app todo.
const tvMatch = window.location.pathname.match(/^\/tv\/([a-zA-Z]+)\/?$/)
if (tvMatch) {
  import('./CardapioTV').then(({ default: CardapioTV }) => {
    root.render(<CardapioTV empresa={tvMatch[1]} />)
  })
} else {
  import('./App').then(({ default: App }) => {
    root.render(<App />)
  })
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

// Detecta nova versão em produção comparando o bundle JS referenciado no HTML
// (o hash muda a cada build). Sem isso, no celular o PWA fica aberto em
// memória — o usuário só troca de app, nunca fecha de verdade — e nunca vê
// as atualizações porque nada força um novo fetch de "/".
if (import.meta.env.PROD) {
  const currentScript = document.querySelector('script[type="module"][src]')?.getAttribute('src') || ''
  const showUpdateBanner = () => {
    if (document.getElementById('app-update-banner')) return
    const bar = document.createElement('div')
    bar.id = 'app-update-banner'
    bar.textContent = '🔄 Nova versão disponível — toque para atualizar'
    bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:999999;background:#8B5CF6;color:#fff;text-align:center;padding:12px 16px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 -2px 12px rgba(0,0,0,.4)'
    bar.onclick = () => window.location.reload()
    document.body.appendChild(bar)
  }
  const checkForUpdate = async () => {
    try {
      const res = await fetch('/', { cache: 'no-store' })
      const html = await res.text()
      const latestScript = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/)?.[1] || ''
      if (currentScript && latestScript && latestScript !== currentScript) showUpdateBanner()
    } catch {}
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate()
  })
  setInterval(checkForUpdate, 5 * 60 * 1000)
}
