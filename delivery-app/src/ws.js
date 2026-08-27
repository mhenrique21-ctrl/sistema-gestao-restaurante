let socket = null
const listeners = new Set()

export function connectWS(token) {
  if (socket?.readyState === WebSocket.OPEN) return
  socket = new WebSocket(`ws://${location.host}/ws?token=${token}`)

  socket.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data)
      listeners.forEach((fn) => fn(msg))
    } catch {}
  }

  socket.onclose = () => {
    // Reconnect after 3s
    setTimeout(() => { if (getToken()) connectWS(getToken()) }, 3000)
  }
}

function getToken() { return localStorage.getItem('token') }

export function onMessage(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function disconnectWS() {
  socket?.close()
  socket = null
}
