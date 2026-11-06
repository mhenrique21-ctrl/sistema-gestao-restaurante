// A varredura da distribuição DF-e: pede um lote, GUARDA, e só então anda o ponteiro.
// ============================================================================
// Mora fora do `new_server.js` pela razão do `registroPdv.js`: é a decisão que
// erra em SILÊNCIO. Quando ela falha não aparece erro nenhum — a nota simplesmente
// não chega, e a pessoa só descobre quando procura uma compra que devia estar lá.
//
// ⚠️ O PONTEIRO (NSU) É A MEMÓRIA DO QUE A SEFAZ JÁ NOS ENTREGOU, e a SEFAZ NÃO
// REENVIA o que já entregou. Ele falha para os dois lados, e os dois já aconteceram:
//
//   ANDOU DEMAIS  → documento entregue e nunca guardado. Perdido de vez.
//     27/08/2026: uma varredura foi do NSU 0 ao 483 e salvou ZERO notas, porque um
//                 lote no meio respondeu 656.
//     22/10/2026: o 656 gravava o "máximo" da SEFAZ e pulava as notas entre o
//                 ponteiro e ele. Perdeu NF.
//
//   FICOU PARA TRÁS → a pergunta seguinte repete um NSU que a SEFAZ já entregou, e
//                 ela responde 656 (consumo indevido) — de novo, e de novo.
//     05/11/2026: ponteiro em 760, cache com notas até o NSU 809, SEFAZ informando
//                 819. Toda varredura virava 656 e as notas de 04 e 05/11 nunca
//                 foram buscadas.
//
// ⚠️ A CAUSA DO SEGUNDO: o ramo 138 de `sefazDistDFe` terminava com
//     `if (maxNSU > nsuResp) saveNsu(...)`
// e `maxNSU` nasce igual a `nsuResp` (o ultNSU da própria resposta) e só o passa se
// algum docZip trouxer NSU maior que o ultNSU do lote — o que não acontece. Era um
// NO-OP. O ponteiro só andava no 137 (fim da fila) e, até o 22/10, no 656. Tirado o
// salto do 656 — que estava certo em tirar —, sobrou uma varredura que relia o
// ponteiro do ARQUIVO a cada chamada e perguntava o mesmo NSU 8 vezes seguidas.
//
// As regras, que os testes travam:
//
//   1. O CACHE VAI ANTES DO PONTEIRO. Se cair no meio, "guardou e não andou" só
//      repete um lote (a fusão é por chave, idempotente); "andou e não guardou" é a
//      nota perdida. Quem manda na ordem é este módulo, não a fiação do servidor.
//   2. O PONTEIRO É LIDO UMA VEZ por varredura e passado adiante. Relê-lo do arquivo a
//      cada chamada é o defeito acima.
//   3. O PONTEIRO SÓ ANDA PARA A FRENTE. Uma resposta com ultNSU menor não o rebaixa.
//   4. NUNCA SE PERGUNTA O MESMO NSU DUAS VEZES na mesma varredura: lote que não fez o
//      ponteiro andar encerra a varredura.
//   5. FALHOU O LOTE? O que veio antes JÁ ESTÁ GUARDADO e o ponteiro parou no último
//      lote bom. O erro sobe como `erroParcial`, para quem chamou tratar depois.

export const MAX_LOTES = 8;

export async function varrer({
  lerPonteiro,     // () => número: o ponteiro persistido (lido UMA vez)
  consultar,       // async (ultNSU) => { nfes, ultNSU }: um lote. Lança em 656, timeout...
  guardar,         // ({ nfes, ultNSU }) => void: grava o cache. Lança se não conseguir
  gravarPonteiro,  // (n) => void: grava o ponteiro. SÓ é chamado depois de `guardar`
  max = MAX_LOTES,
  esperar = async () => {},
} = {}) {
  let cursor = Number(lerPonteiro()) || 0;
  const de = cursor;
  const todas = [];
  let erroParcial = null;
  let lotes = 0;

  for (let i = 0; i < max; i++) {
    let r;
    try {
      r = await consultar(cursor);
    } catch (e) {
      erroParcial = e;
      break;
    }
    lotes++;
    const nfes = r?.nfes || [];
    const proximo = Number(r?.ultNSU) || 0;
    todas.push(...nfes);

    // 1º o cache. Se falhar, o ponteiro NÃO anda.
    if (nfes.length) {
      try { guardar({ nfes, ultNSU: proximo }); } catch (e) { erroParcial = e; break; }
    }

    // 2º o ponteiro — e só para a frente.
    const avancou = proximo > cursor;
    if (avancou) {
      try { gravarPonteiro(proximo); } catch (e) { erroParcial = e; break; }
      cursor = proximo;
    }

    // Sem nota nova (137, ou lote só de eventos) ou sem o ponteiro andar: acabou.
    // Insistir com o mesmo NSU é exatamente o consumo indevido.
    if (!nfes.length || !avancou) break;
    if (i < max - 1) await esperar();
  }

  return { nfes: todas, total: todas.length, ultNSU: cursor, de, lotes, erroParcial };
}

// ── Uma varredura por CNPJ de cada vez ──────────────────────────────────────
// Confraria e Seama têm o MESMO CNPJ, então o mesmo ponteiro. Dois pedidos ao mesmo
// tempo — o ciclo automático e um clique em "Sincronizar", ou as duas abas —
// perguntam o MESMO NSU, e o segundo é consumo indevido garantido. Quem chega
// durante uma varredura recebe a mesma promessa em vez de consultar de novo.
export function unicoEmVoo(emCurso, chave, iniciar) {
  const atual = emCurso.get(chave);
  if (atual) return atual;
  const p = Promise.resolve().then(iniciar).finally(() => { emCurso.delete(chave); });
  emCurso.set(chave, p);
  return p;
}
