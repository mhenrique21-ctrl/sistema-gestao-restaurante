import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularHolerite, contasEsperadas, contasLancadas, conciliarMes,
  totaisDoMes, encargoDescontado, encargoPatronal,
} from './folhaRh.js';

const MES = '2026-09';
const FUNC = { id: 'f1', nome: 'Mário Henrique', salario: 2000 };

// O caso que motivou a correção: a DRE mostrava R$ 2.466,67 de folha contra
// R$ 1.970,00 de desembolso real.
const dbCaso = {
  funcionarios: [FUNC],
  faltas: [{ funcionarioId: 'f1', mes: MES, desconto: 66.67 }],
  consumacoes: [{ funcionarioId: 'f1', mes: MES, valor: 80 }],
  adiantamentos: [],
  encargos: [{ funcionarioId: 'f1', mes: MES, descontado: 150, patronal: 0, bonificacao: 200 }],
  contas: [],
};

test('falta desconta de quem faltou', () => {
  // Antes o total de faltas era calculado e NUNCA usado no valor a receber:
  // a falta não descontava de ninguém e ainda virava despesa na DRE.
  const h = calcularHolerite(dbCaso, FUNC, MES);
  assert.equal(h.faltas, 66.67);
  assert.equal(h.descontos, 296.67);      // 66,67 + 80 + 150
  assert.equal(h.liquido, 1703.33);       // 2000 − 296,67
});

test('bonificação não entra no líquido — ela sai pela conta de encargos', () => {
  // Entrando nos dois, a DRE contava duas vezes.
  const e = contasEsperadas(dbCaso, FUNC, MES);
  assert.equal(e.folha, 1703.33);
  assert.equal(e.encargo, 200);           // 0 patronal + 200 bonificação
  assert.equal(e.holerite.aReceber, 1903.33);
});

test('a folha da DRE passa a ser o desembolso, sem nada inventado', () => {
  const e = contasEsperadas(dbCaso, FUNC, MES);
  assert.equal(e.total, 1903.33);
  assert.equal(e.holerite.custoEmpresa, 1903.33);
  // Antes: 66,67 (falta) + 80 (consumação) + 350 (encargo+bonif) + 1.970 = 2.466,67.
  assert.ok(e.total < 2466.67);
});

test('adiantamento desconta do holerite E soma no desembolso', () => {
  // Não é contradição: o dinheiro já saiu antes. Como a folha lança só o
  // líquido, adiantamento + folha somam exatamente o salário.
  const db = { ...dbCaso, adiantamentos: [{ funcionarioId: 'f1', mes: MES, valor: 500 }] };
  const e = contasEsperadas(db, FUNC, MES);
  assert.equal(e.folha, 1203.33);         // 2000 − 66,67 − 80 − 150 − 500
  assert.equal(e.adiantamento, 500);
  assert.equal(e.folha + e.adiantamento, 1703.33);   // o mesmo líquido de antes
  assert.equal(e.total, 1903.33);         // desembolso não muda por adiantar
});

test('encargo patronal é custo da empresa e não toca no líquido', () => {
  const db = { ...dbCaso,
    encargos: [{ funcionarioId: 'f1', mes: MES, descontado: 150, patronal: 160, bonificacao: 200 }] };
  const e = contasEsperadas(db, FUNC, MES);
  assert.equal(e.folha, 1703.33);         // patronal não desce do líquido
  assert.equal(e.encargo, 360);           // 160 patronal + 200 bonificação
  assert.equal(e.total, 2063.33);
});

test('encargo antigo (campo "valor") continua valendo como desconto', () => {
  // O campo `valor` era o encargo descontado antes de o patronal existir.
  // Traduzido na leitura — não migra dado.
  assert.equal(encargoDescontado({ valor: 150 }), 150);
  assert.equal(encargoDescontado({ descontado: 90, valor: 150 }), 90);
  assert.equal(encargoPatronal({ valor: 150 }), 0);
  const h = calcularHolerite({ ...dbCaso,
    encargos: [{ funcionarioId: 'f1', mes: MES, valor: 150 }] }, FUNC, MES);
  assert.equal(h.encDescontado, 150);
  assert.equal(h.encPatronal, 0);
});

test('desconto maior que o salário não vira conta negativa', () => {
  // Conta a pagar negativa seria conta a RECEBER do funcionário, sentido que o
  // Financeiro não tem aqui. O excedente fica visível em vez de sumir.
  const h = calcularHolerite({ ...dbCaso,
    adiantamentos: [{ funcionarioId: 'f1', mes: MES, valor: 5000 }] }, FUNC, MES);
  assert.equal(h.liquido, 0);
  assert.equal(h.descontoNaoAbsorvido, 3296.67);
});

test('valor em texto com vírgula é lido como número', () => {
  // O formulário grava texto; o RH grava número. Number('1.234,56') é NaN e
  // Number('1.234') é mil duzentos e trinta e quatro milésimos.
  const h = calcularHolerite({ ...dbCaso,
    consumacoes: [{ funcionarioId: 'f1', mes: MES, valor: '1.234,56' }] }, FUNC, MES);
  assert.equal(h.consumacoes, 1234.56);
});

test('mês e funcionário de outro lançamento não vazam', () => {
  const t = totaisDoMes({ ...dbCaso,
    consumacoes: [
      { funcionarioId: 'f1', mes: '2026-08', valor: 999 },
      { funcionarioId: 'f2', mes: MES, valor: 999 },
      { funcionarioId: 'f1', mes: MES, valor: 80 },
    ] }, 'f1', MES);
  assert.equal(t.consumacoes, 80);
});

// ── Conferência ────────────────────────────────────────────────────────────
const comContas = (contas) => ({ ...dbCaso, contas });

test('conta casa por id do funcionário, não pelo nome', () => {
  // Renomear o funcionário não pode desfazer o vínculo.
  const db = comContas([
    { id: 'c1', funcionarioId: 'f1', mesRef: MES, tipoRh: 'folha', valor: 1703.33, tipo: 'saida' },
    { id: 'c2', fornecedor: 'Mário Henrique', valor: 999, tipo: 'saida' },
  ]);
  const l = contasLancadas(db, 'f1', MES);
  assert.equal(l.folha, 1703.33);
  assert.equal(l.total, 1703.33);
});

test('conferência fecha quando tudo foi lançado', () => {
  const db = comContas([
    { id: 'c1', funcionarioId: 'f1', mesRef: MES, tipoRh: 'folha', valor: 1703.33, tipo: 'saida' },
    { id: 'c2', funcionarioId: 'f1', mesRef: MES, tipoRh: 'encargo', valor: 200, tipo: 'saida' },
  ]);
  const r = conciliarMes(db, MES);
  assert.equal(r.linhas[0].status, 'ok');
  assert.equal(r.diferenca, 0);
  assert.deepEqual(r.linhas[0].duplicados, []);
});

test('conferência acusa a folha lançada duas vezes', () => {
  // Clicar duas vezes em "Lançar folha" criava duas contas e a DRE somava as duas.
  const db = comContas([
    { id: 'c1', funcionarioId: 'f1', mesRef: MES, tipoRh: 'folha', valor: 1703.33, tipo: 'saida' },
    { id: 'c2', funcionarioId: 'f1', mesRef: MES, tipoRh: 'folha', valor: 1703.33, tipo: 'saida' },
    { id: 'c3', funcionarioId: 'f1', mesRef: MES, tipoRh: 'encargo', valor: 200, tipo: 'saida' },
  ]);
  const r = conciliarMes(db, MES);
  assert.equal(r.linhas[0].status, 'divergente');
  assert.equal(r.linhas[0].diferenca, 1703.33);
  assert.deepEqual(r.linhas[0].duplicados, ['folha']);
});

test('holerite fechado e nada lançado aparece como pendência', () => {
  const r = conciliarMes(comContas([]), MES);
  assert.equal(r.linhas[0].status, 'nao_lancado');
  assert.equal(r.totalEsperado, 1903.33);
  assert.equal(r.totalLancado, 0);
});

test('conta de Salários sem funcionário fica visível, não some', () => {
  // As que já existem hoje não têm o vínculo, e adivinhar de quem são seria
  // chute. Ficam listadas pra serem ligadas com um toque.
  const db = comContas([
    { id: 'c9', categoria: 'Salários', tipo: 'saida', vencimento: `${MES}-10`, valor: 800 },
    { id: 'c8', categoria: 'Aluguel', tipo: 'saida', vencimento: `${MES}-10`, valor: 3000 },
  ]);
  const r = conciliarMes(db, MES);
  assert.equal(r.semVinculo.length, 1);
  assert.equal(r.semVinculo[0].id, 'c9');
});

test('funcionário sem lançamento nenhum não vira pendência', () => {
  // Salário zero e nada no mês: cobrar lançamento seria ruído.
  const r = conciliarMes({ funcionarios: [{ id: 'f9', nome: 'Novo', salario: 0 }], contas: [] }, MES);
  assert.equal(r.linhas[0].status, 'ok');
});

test('contas antigas de falta e consumação ficam visíveis para o dono decidir', () => {
  // Enquanto falta e consumação viravam conta a pagar de "Salários", elas
  // inflavam a folha da DRE. Apagar dado de mês fechado sem perguntar é pior
  // que mostrar o problema — então elas são listadas, não removidas.
  const db = comContas([
    { id: 'v1', origem: 'falta_rh', categoria: 'Salários', tipo: 'saida', vencimento: `${MES}-03`, valor: 66.67 },
    { id: 'v2', origem: 'consumacao_rh', categoria: 'Salários', tipo: 'saida', vencimento: `${MES}-08`, valor: 80 },
    { id: 'v3', origem: 'folha_rh', categoria: 'Salários', tipo: 'saida', vencimento: `${MES}-05`, valor: 1703.33 },
  ]);
  const r = conciliarMes(db, MES);
  assert.deepEqual(r.legadoDescontos.map((c) => c.id), ['v1', 'v2']);
  // A conta de folha antiga (sem vínculo) é outro caso: ela é legítima, só
  // precisa ser ligada ao funcionário. Não pode ser confundida com as de cima.
  assert.deepEqual(r.semVinculo.map((c) => c.id), ['v3']);
});
