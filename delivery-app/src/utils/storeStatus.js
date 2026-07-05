/**
 * Verifica se a loja está aberta com base em business_hours e special_dates.
 * business_hours: array de { day: string, open: bool, open_time: "HH:MM", close_time: "HH:MM" }
 * special_dates: array de { date: "YYYY-MM-DD", open: bool, open_time?: string, close_time?: string }
 */

const DAY_NAMES = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']
const DAY_NAMES_ALT = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

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
  const now = new Date()
  return now.toISOString().slice(0, 10)
}

export function checkStoreOpen(businessHours, specialDates) {
  const today = todayISO()
  const nowDow = new Date().getDay() // 0=Sun, 1=Mon...
  const now = nowMinutes()

  // Verificar datas especiais primeiro
  if (specialDates && Array.isArray(specialDates)) {
    const special = specialDates.find((d) => d.date === today)
    if (special) {
      if (!special.open) return { open: false, reason: 'Fechado hoje (data especial)' }
      const opens = parseTime(special.open_time)
      const closes = parseTime(special.close_time)
      if (opens != null && closes != null) {
        if (now < opens) return { open: false, reason: `Abre às ${special.open_time}` }
        if (now >= closes) return { open: false, reason: `Fechou às ${special.close_time}` }
      }
      return { open: true }
    }
  }

  // Verificar horário padrão do dia
  if (!businessHours || !Array.isArray(businessHours) || businessHours.length === 0) {
    return { open: true } // sem configuração = sempre aberto
  }

  const dayName = DAY_NAMES[nowDow]
  const dayNameAlt = DAY_NAMES_ALT[nowDow]
  const dayConfig = businessHours.find((d) => {
    const dn = (d.day || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    return dn === dayName || d.day === dayNameAlt
  })

  if (!dayConfig) return { open: true }
  if (!dayConfig.open) return { open: false, reason: 'Fechado hoje' }

  const opens = parseTime(dayConfig.open_time)
  const closes = parseTime(dayConfig.close_time)

  if (opens != null && closes != null) {
    if (now < opens) return { open: false, reason: `Abre às ${dayConfig.open_time}` }
    if (now >= closes) return { open: false, reason: `Fechou às ${dayConfig.close_time}` }
  }

  return { open: true }
}
