// Gravação da Lista de Compras ITEM A ITEM, e não pelo documento inteiro.
// ============================================================================
// Cada toque na Lista acabava num POST do documento INTEIRO da empresa (vários
// MB). No 4G da loja o envio demora, cai ou fica pendurado — e enquanto isso o
// aparelho também não recebe o que os outros fizeram (§3). O relato é sempre
// "inseri e não apareceu para os outros".
//
// Aqui chega só a operação (`add`, `update`, `marcar`, `remove`, `descartar`),
// de poucos KB, e o servidor a aplica sobre o arquivo com A MESMA regra da
// fusão (`mergeListaCompras`): carimbo `updatedAt` maior vence, e id no
// tombstone não volta. Mora fora do App.tsx porque roda no servidor e é a
// parte que precisa de teste: uma regra diferente da fusão faria o POST
// seguinte de qualquer aparelho desfazer o que a operação gravou.

// ⚠️ UM NÚMERO SÓ para o tamanho do tombstone, servidor e app. Eram dez
// `.slice(-5000)` espalhados, e o `listaDeletedIds` real chegou nos 5000: daí
// em diante cada exclusão empurrava a mais antiga para fora, e um aparelho com
// dado velho ressuscitava item já excluído ou arquivado.
export const MAX_TOMBSTONES = 30000;
// Quanto a poda tira de uma vez abaixo do teto. Sem folga, a varredura (cara)
// rodaria a cada exclusão depois de o teto ser atingido.
export const FOLGA_PODA = 2000;
export const LIXEIRA_DIAS = 30;
const DIA_MS = 24 * 3600 * 1000;

// ⚠️ O id da entrada NÃO é o id do item: o id do item vai para o tombstone
// genérico (`deletedIds`) na exclusão, e a fusão por id (`mergeArrayById`)
// apagaria a própria entrada da lixeira.
export function idDaLixeira(itemId) { return 'lx-' + itemId; }

// ⚠️ PODA SEM PERDA. Cortar pelos mais antigos às cegas é o que ressuscitava
// item: um aparelho com dado velho ainda tem aquele item, e sem o id no
// tombstone a fusão o devolve. Só sai do tombstone o id que NÃO existe mais em
// nenhuma `listaCompras` dos backups recentes (`vivos`) — esse não tem de onde
// voltar. Sem saber quem está vivo, não poda nada: passar do teto é melhor
// que perder uma exclusão.
export function podarTombstones(ids, { max = MAX_TOMBSTONES, vivos = null, folga = FOLGA_PODA } = {}) {
  const arr = [...new Set(ids || [])];
  if (arr.length <= max || !vivos) return arr;
  const alvo = Math.max(0, max - folga);
  let sobra = arr.length - alvo;
  const out = [];
  for (const id of arr) {
    if (sobra > 0 && !vivos.has(id)) { sobra--; continue; }
    out.push(id);
  }
  return out;
}

export function lixeiraValida(lixeira, agora = Date.now(), dias = LIXEIRA_DIAS) {
  const limite = agora - dias * DIA_MS;
  return (Array.isArray(lixeira) ? lixeira : []).filter((e) => {
    if (!e?.id) return false;
    const t = Date.parse(e.excluidoEm || '');
    return !Number.isFinite(t) || t >= limite;
  });
}

const TIPOS = new Set(['add', 'update', 'marcar', 'remove', 'descartar']);
// Campos que uma operação não pode trocar: o id é a identidade, e o carimbo
// é decidido aqui, pela regra da fusão.
const PROTEGIDOS = new Set(['id', 'updatedAt']);

export function aplicarOpsLista(doc, ops, { agora = Date.now(), vivos = null } = {}) {
  const base = doc && typeof doc === 'object' ? doc : {};
  const lista = [...(Array.isArray(base.listaCompras) ? base.listaCompras : [])];
  const tomb = new Set(base.listaDeletedIds || []);
  const tombGeral = new Set(base.deletedIds || []);
  let lixeira = [...(Array.isArray(base.listaLixeira) ? base.listaLixeira : [])];
  const idx = new Map(lista.map((i, k) => [i?.id, k]));
  const resultados = [];
  let mudou = false;

  for (const op of Array.isArray(ops) ? ops : []) {
    const tipo = op?.tipo;
    const id = op?.item?.id ?? op?.id;
    if (!TIPOS.has(tipo) || !id) { resultados.push({ id: id ?? null, tipo, status: 'invalida' }); continue; }
    const em = Number(op.em) || agora;

    if (tipo === 'descartar') {
      const antes = lixeira.length;
      lixeira = lixeira.filter((e) => e.id !== id);
      if (!tombGeral.has(id)) { tombGeral.add(id); mudou = true; }
      if (lixeira.length !== antes) mudou = true;
      resultados.push({ id, tipo, status: 'ok' });
      continue;
    }

    if (tipo === 'remove') {
      const k = idx.get(id);
      if (k !== undefined) {
        const item = lista[k];
        lista.splice(k, 1);
        idx.clear(); lista.forEach((i, j) => idx.set(i?.id, j));
        const lx = idDaLixeira(id);
        if (!lixeira.some((e) => e.id === lx)) {
          lixeira.push({ id: lx, item, excluidoEm: new Date(em).toISOString(), excluidoPor: String(op.por || '') });
        }
        mudou = true;
      }
      if (!tomb.has(id)) { tomb.add(id); mudou = true; }
      resultados.push({ id, tipo, status: 'ok' });
      continue;
    }

    // ⚠️ Id no tombstone NÃO volta, nem por `add`: é a regra que impede um
    // aparelho atrasado de ressuscitar o que outro excluiu. Restaurar da
    // lixeira cunha um id NOVO (a lição do `registroPdv.js`, §3).
    if (tomb.has(id)) { resultados.push({ id, tipo, status: 'excluido' }); continue; }

    const k = idx.get(id);
    if (tipo === 'add') {
      const item = op.item;
      if (!item || typeof item !== 'object' || !item.nome) { resultados.push({ id, tipo, status: 'invalida' }); continue; }
      const novo = { ...item, updatedAt: Number(item.updatedAt) || em };
      if (k === undefined) {
        idx.set(id, lista.length); lista.push(novo); mudou = true;
        resultados.push({ id, tipo, status: 'ok' });
      } else if ((Number(lista[k].updatedAt) || 0) <= novo.updatedAt) {
        lista[k] = novo; mudou = true;
        resultados.push({ id, tipo, status: 'ok' });
      } else {
        resultados.push({ id, tipo, status: 'antigo' });
      }
      continue;
    }

    // update / marcar
    if (k === undefined) { resultados.push({ id, tipo, status: 'ausente' }); continue; }
    // ⚠️ Estritamente MAIOR perde: no empate a operação vence, como o incoming
    // vence no empate da fusão. Quem acabou de mexer é quem mandou.
    if ((Number(lista[k].updatedAt) || 0) > em) { resultados.push({ id, tipo, status: 'antigo' }); continue; }
    const campos = {};
    for (const [c, v] of Object.entries(op.campos || {})) if (!PROTEGIDOS.has(c)) campos[c] = v;
    lista[k] = { ...lista[k], ...campos, updatedAt: em };
    mudou = true;
    resultados.push({ id, tipo, status: 'ok' });
  }

  const lixeiraFinal = lixeiraValida(lixeira, agora);
  if (lixeiraFinal.length !== lixeira.length) mudou = true;
  if (!mudou) return { doc: base, resultados, mudou: false };
  const novo = {
    ...base,
    listaCompras: lista.filter((i) => !tomb.has(i?.id)),
    listaDeletedIds: podarTombstones([...tomb], { vivos }),
    listaLixeira: lixeiraFinal,
  };
  if (tombGeral.size !== (base.deletedIds || []).length) novo.deletedIds = [...tombGeral].slice(-MAX_TOMBSTONES);
  return { doc: novo, resultados, mudou: true };
}
