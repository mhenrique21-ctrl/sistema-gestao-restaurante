// De qual aplicativo veio a comanda — e o que dá pra fazer com ela.
// ============================================================================
// A ponte deixou de servir só ao 99Food: o iFood imprime do mesmo jeito, e os
// dois podem chegar no mesmo computador. Duas coisas mudam com isso:
//
//   1. a captura precisa SABER de quem é cada comanda, senão o pedido do iFood
//      entraria em Vendas como se fosse do 99Food — canais com taxa diferente;
//   2. cada aplicativo tem o próprio layout, então o leitor é por plataforma.
//      Os dois foram escritos em cima de comanda REAL — o do 99Food na #871001,
//      o do iFood num pedido de teste capturado no caixa em 15/09/2026. Nenhum
//      dos dois saiu de layout imaginado, que é o erro que este projeto já
//      pagou duas vezes.
//
//   ⚠️ E as contas dos dois NÃO são iguais: no 99Food repasse + cobrança do
//      cliente fecham o total; no iFood o total é só a mercadoria e as taxas
//      entram por fora. Usar uma fórmula na outra acusa divergência em todo
//      pedido — por isso cada leitor tem a própria conferência.
//
// Mora fora do agent.js porque é o que muda quando entrar a terceira
// plataforma, e é a única parte testável sem impressora na mesa.

// Sem acento, minúsculo, espaço colapsado — a térmica pode devolver o
// acentuado errado (numa captura real "verificação" voltou "verificaúo"), e
// comparar a frase inteira faz o reconhecimento sumir justo quando ele importa.
export function fold(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export const PLATAFORMAS = {
  '99food': { rotulo: '99Food', temLeitor: true },
  ifood:    { rotulo: 'iFood',  temLeitor: true },
};

export function rotuloPlataforma(p) {
  return PLATAFORMAS[p]?.rotulo || 'origem desconhecida';
}

// ⚠️ "99food" NÃO contém "ifood" — é por isso que dá pra separar os dois por
// substring simples. A ordem importa: o 99Food é testado primeiro porque a
// comanda dele traz "Cobrar do cliente", que o iFood também pode trazer.
export function detectarPlataforma(texto) {
  const t = fold(texto);
  if (t.includes('99food') || t.includes('99 food')) return '99food';
  if (t.includes('ifood') || t.includes('i food')) return 'ifood';
  return '';
}

// Junta o que a INSTALAÇÃO diz (cada aplicativo imprimindo na própria pasta)
// com o que a COMANDA diz. A comanda ganha quando as duas discordam: pasta
// trocada é erro de instalação silencioso, e seguir o rótulo mandaria o pedido
// pro canal errado em Vendas. O aviso é o que faz alguém ir arrumar.
export function resolverOrigem(rotulada, texto) {
  const detectada = detectarPlataforma(texto);
  const rot = (rotulada || '').toLowerCase();
  if (!rot) return { origem: detectada, avisos: [] };
  if (!detectada) return { origem: rot, avisos: [] };
  if (detectada === rot) return { origem: rot, avisos: [] };
  return {
    origem: detectada,
    avisos: [`a comanda chegou pela captura do ${rotuloPlataforma(rot)} mas é do `
      + `${rotuloPlataforma(detectada)} — confira qual impressora cada aplicativo está usando.`],
  };
}

// O leitor existe? Só o do 99Food, hoje. Devolver "não sei ler" é melhor que um
// palpite: o .bin guardado permite escrever o leitor do iFood depois, em cima
// de uma comanda de verdade, sem esperar pedido novo.
export function temLeitor(origem) {
  return !!PLATAFORMAS[origem]?.temLeitor;
}
