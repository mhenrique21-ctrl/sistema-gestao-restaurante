// Folha de pagamento: o que é desconto, o que é desembolso, o que vai pra DRE.
// ============================================================================
// Mora fora do App.tsx porque foi exatamente aqui que o erro nasceu, e erro de
// folha não aparece na tela: aparece na DRE, meses depois, como "custo de
// pessoal alto".
//
// O QUE ESTAVA ERRADO (corrigido por decisão do dono em 14/09/2026):
//
//   • FALTA virava conta a pagar de "Salários" — desconto entrando como
//     despesa NOVA. E o total de faltas era calculado no valor a receber e
//     NUNCA usado: a falta não descontava de quem faltou e ainda inflava a
//     folha. Errado dos dois lados.
//   • CONSUMAÇÃO, idem: o funcionário consumiu da loja e isso desconta do que
//     ele recebe. Não é dinheiro a mais saindo do caixa.
//   • ENCARGO usava UM campo pros dois sentidos — era somado como custo da
//     empresa E descontado do líquido ao mesmo tempo.
//   • BONIFICAÇÃO/COMISSÃO entravam na conta de encargos E dentro do líquido
//     da folha: contadas duas vezes na DRE.
//   • ADIANTAMENTO ficava FORA da DRE com a justificativa de que "o valor
//     cheio já aparece em Salários" — mas a folha é lançada pelo LÍQUIDO, já
//     sem ele. O dinheiro saía do caixa e não estava em lugar nenhum.
//
// Num funcionário de R$ 2.000 com uma falta, R$ 80 de consumação, R$ 150 de
// encargo e R$ 200 de bonificação, a DRE mostrava R$ 2.466,67 de folha contra
// R$ 1.970,00 de desembolso real. 25% de folha inventada, num funcionário só.
//
// A REGRA ÚNICA DEPOIS DA CORREÇÃO: cada real aparece UMA vez.
//
//   desconto   reduz o que o funcionário recebe · NÃO vira conta
//   desembolso sai do caixa · vira conta e entra na folha da DRE
//
// | item                        | no holerite | vira conta? |
// |-----------------------------|-------------|-------------|
// | falta                       | desconto    | não         |
// | consumação                  | desconto    | não         |
// | encargo descontado (INSS)   | desconto    | não         |
// | adiantamento                | desconto    | SIM         |
// | encargo patronal (FGTS)     | —           | SIM         |
// | bonificação/comissão/sal.fam| acréscimo   | SIM         |
// | líquido da folha            | o resultado | SIM         |
//
// Adiantamento é desconto NO HOLERITE e desembolso NO CAIXA ao mesmo tempo, e
// isso não é contradição: o dinheiro já saiu antes. Como a folha lança só o
// líquido, adiantamento + folha somam exatamente o salário — sem duplicar.

// Bonificação, comissão e salário família são pagos AO funcionário mas saem
// pela conta de encargos, por decisão do dono. Ficam fora do líquido da folha
// justamente pra não serem contados nos dois lançamentos.
export const TIPOS_CONTA_RH = ['folha', 'encargo', 'adiantamento'];

const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (v == null || v === '') return 0;
  // Aceita "1.234,56" e "1234.56": o RH grava número, mas formulário grava texto.
  const t = String(v).trim().replace(/\s/g, '');
  const n = /,/.test(t) ? parseFloat(t.replace(/\./g, '').replace(',', '.')) : parseFloat(t);
  return Number.isFinite(n) ? n : 0;
};
const red = (lista, fn) => (lista || []).reduce((s, x) => s + fn(x), 0);
const cent = (v) => Math.round((v || 0) * 100) / 100;

// `valor` era o nome do encargo DESCONTADO do funcionário antes de o campo
// patronal existir. Traduzido na leitura, como o LEGADO do tipoInsumo.js — não
// migre dado por isso: encargo antigo continua valendo do jeito que foi salvo.
export const encargoDescontado = (e) => num(e?.descontado != null ? e.descontado : e?.valor);
export const encargoPatronal = (e) => num(e?.patronal);

const doMes = (lista, funcId, mes) =>
  (lista || []).filter((x) => x && x.funcionarioId === funcId && x.mes === mes);

export function totaisDoMes(db, funcId, mes) {
  const encs = doMes(db?.encargos, funcId, mes);
  return {
    faltas:        cent(red(doMes(db?.faltas, funcId, mes), (x) => num(x.desconto))),
    adiantamentos: cent(red(doMes(db?.adiantamentos, funcId, mes), (x) => num(x.valor))),
    consumacoes:   cent(red(doMes(db?.consumacoes, funcId, mes), (x) => num(x.valor))),
    encDescontado: cent(red(encs, encargoDescontado)),
    encPatronal:   cent(red(encs, encargoPatronal)),
    bonificacao:   cent(red(encs, (x) => num(x.bonificacao))),
    comissao:      cent(red(encs, (x) => num(x.comissao))),
    salarioFamilia:cent(red(encs, (x) => num(x.salarioFamilia))),
  };
}

// O holerite do mês. `liquido` é o que a conta de folha lança; `aReceber` é o
// que o funcionário leva no total — os dois diferem justamente porque os
// acréscimos saem pela conta de encargos.
export function calcularHolerite(db, func, mes) {
  const t = totaisDoMes(db, func?.id, mes);
  const salario = num(func?.salario);
  const descontos = cent(t.faltas + t.adiantamentos + t.consumacoes + t.encDescontado);
  const acrescimos = cent(t.bonificacao + t.comissao + t.salarioFamilia);
  // Nunca negativo: desconto maior que o salário viraria conta a RECEBER do
  // funcionário, e o Financeiro não tem esse sentido aqui. O excedente fica
  // visível em `descontoNaoAbsorvido` em vez de sumir na conta.
  const liquido = cent(Math.max(salario - descontos, 0));
  const naoAbsorvido = cent(Math.max(descontos - salario, 0));
  return {
    funcionarioId: func?.id, nome: func?.nome, mes,
    salario, ...t, descontos, acrescimos, liquido,
    descontoNaoAbsorvido: naoAbsorvido,
    aReceber: cent(liquido + acrescimos),
    // O que a empresa desembolsa com esse funcionário no mês — é este número
    // que tem que bater com a linha "Folha e encargos" da DRE.
    custoEmpresa: cent(liquido + acrescimos + t.encPatronal + t.adiantamentos),
  };
}

// O que DEVE estar lançado no Financeiro. Uma função só, usada pelo botão de
// lançar e pela Conferência, pras duas não discordarem entre si — mesma razão
// do resolverItemVendido ser único.
export function contasEsperadas(db, func, mes) {
  const h = calcularHolerite(db, func, mes);
  const encargoTotal = cent(h.encPatronal + h.acrescimos);
  return {
    holerite: h,
    folha: h.liquido,
    encargo: encargoTotal,
    adiantamento: h.adiantamentos,
    total: cent(h.liquido + encargoTotal + h.adiantamentos),
  };
}

// Contas do Financeiro que pertencem a este funcionário neste mês.
// Casa por `funcionarioId` + `mesRef`, nunca por nome: renomear o funcionário
// não pode desfazer o vínculo — mesma lição do código do produto do Eclética.
export function contasLancadas(db, funcId, mes) {
  const achadas = (db?.contas || []).filter((c) =>
    c && c.funcionarioId === funcId && c.mesRef === mes && c.tipoRh);
  const somaDe = (tipo) => cent(red(achadas.filter((c) => c.tipoRh === tipo), (c) => num(c.valor)));
  return {
    folha: somaDe('folha'),
    encargo: somaDe('encargo'),
    adiantamento: somaDe('adiantamento'),
    total: cent(red(achadas, (c) => num(c.valor))),
    contas: achadas,
  };
}

// Conferência do mês: o que o RH calculou contra o que está no Financeiro.
// `status` existe pra tela não precisar recalcular a mesma regra e errar
// diferente: 'ok' | 'nao_lancado' | 'divergente'.
export function conciliarMes(db, mes) {
  const linhas = (db?.funcionarios || []).map((f) => {
    const esperado = contasEsperadas(db, f, mes);
    const lancado = contasLancadas(db, f.id, mes);
    const diferenca = cent(lancado.total - esperado.total);
    let status = 'ok';
    if (esperado.total > 0 && lancado.total === 0) status = 'nao_lancado';
    else if (Math.abs(diferenca) >= 0.01) status = 'divergente';
    // Lançar duas vezes o mesmo mês era possível e a DRE somava os dois.
    const duplicados = TIPOS_CONTA_RH.filter(
      (t) => lancado.contas.filter((c) => c.tipoRh === t).length > 1);
    return { funcionarioId: f.id, nome: f.nome, esperado, lancado, diferenca, status, duplicados };
  }).sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));

  return {
    mes,
    linhas,
    totalEsperado: cent(red(linhas, (l) => l.esperado.total)),
    totalLancado: cent(red(linhas, (l) => l.lancado.total)),
    diferenca: cent(red(linhas, (l) => l.diferenca)),
    // Contas de folha que ninguém ligou a funcionário. As que já existiam antes
    // do vínculo não têm como ser adivinhadas — ficam visíveis pra serem
    // ligadas, em vez de sumirem da conferência como se não existissem.
    semVinculo: (db?.contas || []).filter((c) =>
      c && !c.funcionarioId && c.tipo === 'saida'
      && String(c.mesRef || c.vencimento || '').slice(0, 7) === mes
      && /^sal[aá]rios$/i.test(String(c.categoria || ''))
      && !ORIGENS_LEGADO.includes(c.origem)),
    // Contas que o RH criou quando falta e consumação viravam conta a pagar.
    // Continuam somando na folha da DRE. Não são apagadas sozinhas — apagar
    // dado de meses fechados sem perguntar é pior que mostrar o problema.
    legadoDescontos: contasLegadoDesconto(db, mes),
  };
}

// `origem` é o rastro deixado pelo RH de antes. É por ele que dá pra achar as
// contas criadas pela regra antiga sem depender da descrição, que muda.
export const ORIGENS_LEGADO = ['falta_rh', 'consumacao_rh'];

export function contasLegadoDesconto(db, mes) {
  return (db?.contas || []).filter((c) => c && ORIGENS_LEGADO.includes(c.origem)
    && (!mes || String(c.mesRef || c.vencimento || '').slice(0, 7) === mes));
}
