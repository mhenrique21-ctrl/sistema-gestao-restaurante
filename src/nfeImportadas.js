// Quais NF-e já entraram no sistema.
// ============================================================================
// Mora fora do App.tsx porque o erro aqui é caro e silencioso: reimportar uma
// nota cria a compra de novo, a conta a pagar de novo e estraga o CMV do mês,
// sem nada na tela denunciando.
//
// A LISTA DA SEFAZ NÃO SERVE DE MEMÓRIA. Ela é limpa quando a nota é importada,
// mas essa limpeza é de UMA lista: "↩ Do início" reseta o contador da SEFAZ e
// traz tudo de volta, importadas inclusive. E a remoção do cache é uma chamada
// de rede que pode falhar — a nota some da tela e volta na próxima abertura.
//
// A memória de verdade é a CHAVE DE ACESSO de 44 dígitos: identificador fiscal
// único da nota, que não muda e não depende de nada que a tela faça.
//
// ⚠️ Lê a chave de `compras` E de `contas`. A importação sempre gravou a chave
// na conta a pagar e nunca na compra — então, sem olhar as duas, todo o
// histórico anterior a esta mudança ficaria invisível e voltaria a aparecer
// como nota nova.

// Só os dígitos: a mesma chave aparece com espaços na tela ("1626 0906 …") e
// sem espaços no XML. Comparar como veio faria a mesma nota parecer duas.
export const foldChave = (v) => String(v || '').replace(/\D/g, '');

export const chaveValida = (v) => foldChave(v).length === 44;

export function chavesImportadas(db) {
  const out = new Set();
  const colher = (lista) => (lista || []).forEach((x) => {
    const k = foldChave(x?.chNFe);
    if (k.length === 44) out.add(k);
  });
  colher(db?.compras);
  colher(db?.contas);
  return out;
}

export function jaImportada(db, nfe, chaves) {
  const k = foldChave(nfe?.chNFe);
  if (k.length !== 44) return false;      // sem chave não dá pra afirmar nada
  return (chaves || chavesImportadas(db)).has(k);
}

// Separa a lista da SEFAZ entre o que ainda falta importar e o que já entrou.
// As já importadas não somem caladas: voltam em `ocultas` pra tela poder dizer
// quantas escondeu — sumir sem explicação faria a pessoa procurar a nota.
export function separarImportadas(db, lista) {
  const chaves = chavesImportadas(db);
  const visiveis = [], ocultas = [];
  for (const n of lista || []) (jaImportada(db, n, chaves) ? ocultas : visiveis).push(n);
  return { visiveis, ocultas };
}
