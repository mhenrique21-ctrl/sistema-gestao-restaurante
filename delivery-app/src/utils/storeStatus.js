/**
 * Verifica se a loja está aberta com base em business_hours e special_dates.
 *
 * business_hours: objeto { 0: {open, from, to}, 1: ..., 6: ... }
 *   onde 0=Segunda, 1=Terça, 2=Quarta, 3=Quinta, 4=Sexta, 5=Sábado, 6=Domingo
 *
 * special_dates: array de { date: "YYYY-MM-DD", open: bool, from?: string, to?: string }
 */

// JS getDay(): 0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sab
// Admin index:  6=Dom, 0=Seg, 1=Ter, 2=Qua, 3=Qui, 4=Sex, 5=Sab
// Conversão: adminIndex = (jsDay + 6) % 7
function jsToAdminIndex(jsDay) {
  return (jsDay + 6) % 7
}

function parseTime(str) {
  if (!str) return null
  const [h, m] = str.split(':').map(Number)
  return h * 60 + m
}

function nowMinutes() {
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes()
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function checkStoreOpen(businessHours, specialDates) {
  const today = todayISO()
  const jsDay = new Date().getDay()
  const now = nowMinutes()

  // 1. Verificar datas especiais primeiro
  if (specialDates && Array.isArray(specialDates)) {
    const special = specialDates.find((d) => d.date === today)
    if (special) {
      if (!special.open) return { open: false, reason: 'Fechado hoje (data especial)' }
      const opens = parseTime(special.from || special.open_time)
      const closes = parseTime(special.to || special.close_time)
      if (opens != null && closes != null) {
        if (now < opens) return { open: false, reason: `Abre às ${special.from || special.open_time}` }
        if (now >= closes) return { open: false, reason: `Fechou às ${special.to || special.close_time}` }
      }
      return { open: true }
    }
  }

  // 2. Sem configuração = sempre aberto
  if (!businessHours || typeof businessHours !== 'object') return { open: true }

  const adminIdx = jsToAdminIndex(jsDay)
  const dayConfig = businessHours[adminIdx]

  if (!dayConfig) return { open: true }
  if (!dayConfig.open) return { open: false, reason: 'Fechado hoje' }

  const opens = parseTime(dayConfig.from)
  const closes = parseTime(dayConfig.to)

  if (opens != null && closes != null) {
    if (now < opens) return { open: false, reason: `Abre às ${dayConfig.from}` }
    if (now >= closes) return { open: false, reason: `Fechou às ${dayConfig.to}` }
  }

  return { open: true }
}
