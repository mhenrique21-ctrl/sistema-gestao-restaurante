// Desconto de falta conforme a CLT: o dia E o repouso semanal.
// ============================================================================
// Antes daqui a falta descontava só o dia trabalhado. A lei manda descontar
// também o DSR: falta injustificada faz perder a remuneração do repouso daquela
// semana (Lei 605/49, art. 6º — o repouso é devido a quem trabalhou a semana
// "cumprindo integralmente o seu horário").
//
// ⚠️ O DSR É POR SEMANA, NÃO POR FALTA. Faltar duas vezes na mesma semana faz
// perder UM repouso — só existe um. Faltar em duas semanas faz perder dois.
// Calcular por lançamento ("2 faltas × 2 dias") cobraria um dia a mais do
// colaborador, e é o erro que este módulo existe pra impedir.
//
// ⚠️ POR ISSO O DSR NÃO É GRAVADO NA FALTA. Ele depende do CONJUNTO de faltas
// do mês: gravar em cada lançamento faria a segunda falta da semana guardar
// zero, e excluir a primeira deixaria a semana sem DSR nenhum. É sempre
// derivado na leitura, então excluir uma falta recalcula sozinho.
//
// Decisões do dono (15/09/2026):
//   • o repouso é DOMINGO para todos — a loja fecha domingo
//   • feriado na semana NÃO é descontado (o entendimento majoritário diz que
//     também se perde, mas exigiria um calendário de feriados que não existe)
//   • atraso NÃO faz perder o DSR (o sistema nem registra atraso)
//
// ⚠️ Convenção coletiva pode ser mais benéfica que a lei. Isto implementa a
// regra legal; o que o sindicato negociou é conferência da contabilidade.

// Mensalista tem salário-dia = salário ÷ 30, independente de o mês ter 28 ou
// 31 dias (mês comercial, art. 64 da CLT).
export const DIVISOR_SALARIO_DIA = 30;

export const TIPOS_AUSENCIA = ['injustificada', 'atestado', 'art473', 'abonada'];

// Só a injustificada desconta. As outras ficam registradas para o controle de
// frequência e para o limite de dias do inciso.
export const ehJustificada = (tipo) => tipo != null && tipo !== 'injustificada';

// Ausências do art. 473 da CLT — o limite entra na tela pra ninguém abonar mais
// dias do que a lei dá.
export const MOTIVOS_473 = [
  { id: 'obito',       inciso: 'I',    dias: 2, nome: 'Falecimento de cônjuge, ascendente, descendente, irmão ou dependente' },
  { id: 'casamento',   inciso: 'II',   dias: 3, nome: 'Casamento' },
  { id: 'nascimento',  inciso: 'III',  dias: 5, nome: 'Nascimento de filho (licença-paternidade)' },
  { id: 'sangue',      inciso: 'IV',   dias: 1, nome: 'Doação voluntária de sangue (1 por ano)' },
  { id: 'eleitoral',   inciso: 'V',    dias: 2, nome: 'Alistamento eleitoral' },
  { id: 'militar',     inciso: 'VI',   dias: null, nome: 'Serviço militar' },
  { id: 'vestibular',  inciso: 'VII',  dias: null, nome: 'Exame vestibular' },
  { id: 'juizo',       inciso: 'VIII', dias: null, nome: 'Comparecimento a juízo' },
  { id: 'gestante',    inciso: 'X',    dias: 2, nome: 'Acompanhar consulta/exame de gestante' },
  { id: 'filho',       inciso: 'XI',   dias: 1, nome: 'Acompanhar filho de até 6 anos em consulta (1 por ano)' },
  { id: 'preventivo',  inciso: 'XII',  dias: 3, nome: 'Exames preventivos de câncer' },
];

const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v == null || v === '') return 0;
  const t = String(v).trim().replace(/\s/g, '');
  const n = /,/.test(t) ? parseFloat(t.replace(/\./g, '').replace(',', '.')) : parseFloat(t);
  return Number.isFinite(n) ? n : 0;
};
const cent = (v) => Math.round((v || 0) * 100) / 100;

// Sem arredondar: 2.269,40 ÷ 30 = 75,646666… Arredondar aqui e multiplicar por
// 2 dá 151,30 em vez de 151,29 — um centavo por falta, por colaborador, é o que
// faz a folha não fechar com a contabilidade.
export const salarioDia = (salario) => num(salario) / DIVISOR_SALARIO_DIA;

const emDias = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
// Dia da semana com segunda = 1 e domingo = 7 (getUTCDay devolve domingo = 0).
// UTC de propósito: o app guarda "AAAA-MM-DD" e a hora local jogaria a data
// para o dia anterior a oeste de Greenwich — o Amapá é UTC−3.
const diaIso = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.getUTCDay() === 0 ? 7 : d.getUTCDay();
};

// O domingo que ENCERRA a semana da data. É ele que identifica a semana (duas
// faltas com o mesmo domingo perdem um repouso só).
export function domingoDaSemana(iso) {
  const n = diaIso(iso);
  return n == null ? null : emDias(iso, 7 - n);
}

// Expande "3 dias a partir de tal data" em datas, pulando domingo: não se falta
// no dia de folga, e contar o domingo como falta descontaria o repouso duas
// vezes — uma como dia, outra como DSR.
export function diasDaFalta(iso, dias) {
  const n = Math.max(Math.floor(num(dias)) || 1, 1);
  const out = [];
  let cursor = iso;
  for (let guarda = 0; out.length < n && guarda < n * 3 + 14; guarda++) {
    if (!cursor) break;
    if (diaIso(cursor) !== 7) out.push(cursor);
    cursor = emDias(cursor, 1);
  }
  return out;
}

// O desconto do mês inteiro, de um funcionário. Recebe a lista de faltas já
// filtrada por funcionário e mês.
export function descontoDoMes(faltas, salario) {
  const dia = salarioDia(salario);
  const datas = [];
  const semanas = new Map();

  for (const f of faltas || []) {
    if (!f || ehJustificada(f.tipo)) continue;          // sem tipo = injustificada
    for (const d of diasDaFalta(f.data, f.dias)) {
      datas.push(d);
      const dom = domingoDaSemana(d);
      if (!dom) continue;
      if (!semanas.has(dom)) semanas.set(dom, []);
      semanas.get(dom).push(d);
    }
  }

  const diasDescontados = datas.length;
  const dsrPerdidos = semanas.size;
  // Arredonda o TOTAL, não cada parcela; a linha do DSR recebe o resíduo pra
  // que as duas SEMPRE somem o total mostrado. Sem isso a tela exibiria
  // 75,65 + 75,65 = 151,30 ao lado de um total de 151,29.
  const total = cent(dia * (diasDescontados + dsrPerdidos));
  const valorDias = cent(dia * diasDescontados);
  return {
    salarioDia: dia,
    diasDescontados,
    dsrPerdidos,
    valorDias,
    valorDsr: cent(total - valorDias),
    total,
    semanas: [...semanas.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([domingo, dias]) => ({ domingo, dias, valorDsr: cent(dia) })),
  };
}

// Prévia para o formulário: o que ESTA falta acrescenta, considerando as que já
// existem. É o que mostra "o DSR desta semana já foi descontado" em vez de
// cobrar o repouso duas vezes sem ninguém perceber.
//
// ⚠️ É INCREMENTAL de propósito: o quanto o desconto do MÊS aumenta, não o valor
// da falta isolada. Duas faltas iguais podem mostrar 151,29 e 151,30 — parece um
// centavo errado e não é, é o resíduo do arredondamento do mês caindo numa
// delas. Mostrar 151,29 nas duas faria a soma da tela dar 302,58 contra os
// 302,59 que o holerite vai descontar.
export function previaFalta({ faltasExistentes = [], salario, data, dias = 1, tipo = 'injustificada' }) {
  const dia = salarioDia(salario);
  if (ehJustificada(tipo)) {
    return { salarioDia: dia, dias: 0, valorDias: 0, dsrNovo: false, valorDsr: 0,
      total: 0, justificada: true, domingo: domingoDaSemana(data), dsrJaDescontadoPor: null };
  }
  const antes = descontoDoMes(faltasExistentes, salario);
  const depois = descontoDoMes([...faltasExistentes, { data, dias, tipo }], salario);
  const domingo = domingoDaSemana(data);
  const semanaAntes = antes.semanas.find((s) => s.domingo === domingo);
  const diasNovos = depois.diasDescontados - antes.diasDescontados;
  const total = cent(depois.total - antes.total);
  const valorDias = cent(dia * diasNovos);
  return {
    salarioDia: dia,
    dias: diasNovos,
    valorDias,
    dsrNovo: depois.dsrPerdidos > antes.dsrPerdidos,
    valorDsr: cent(total - valorDias),
    total,
    justificada: false,
    domingo,
    // Qual falta já custou o repouso desta semana — é o que a tela mostra pra
    // pessoa entender por que o desconto veio menor do que ela esperava.
    dsrJaDescontadoPor: semanaAntes ? semanaAntes.dias[0] : null,
  };
}
