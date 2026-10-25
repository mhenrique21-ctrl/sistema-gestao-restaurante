# Lista de compras — plano de implementação (para o Claude Code)

Leia o CLAUDE.md do projeto antes de começar e siga as regras dele (em especial §1, §3 e §6).
Trabalhe em `/var/www/app-gestao`. Faça backup de `new_server.js`, `src/App.tsx`, `src/*.js` e
`dados/*.json` antes de cada etapa. Uma etapa por vez: implementar → `npm test` verde → `npm run build`
→ `pm2 restart app-gestao --update-env` → validar com 2 aparelhos → só então a próxima.
Sempre fora do horário de compra (evitar 18h–12h no deploy; o ideal é entre 13h e 15h).

## Regra de negócio (decidida pelo dono)
- **Dia operacional da lista: das 12h de um dia até as 12h do dia seguinte** (America/Belem).
  A lista começa a ser alimentada às 18h e a compra é de manhã.
- A lista leva o nome da **data da compra**: item lançado em 24/10 às 18h30 → "Compra de 25/10".
- **Às 12h** a lista aberta é arquivada sozinha em `pedidosLista` com a data da compra, e uma lista
  nova e vazia é aberta. Item lançado depois das 12h vai para a lista do dia seguinte.
- Fechar manualmente antes das 12h continua funcionando.
- **Nada some sem volta**: nenhum caminho automático pode apagar itens sem passar pelo Arquivo
  ou pela lixeira.

## Restrição: não mexer no banco
Mesmo arquivo (`dados/<empresa>.json`), mesmos campos. Só é permitido **acrescentar campos
opcionais** (ex.: `excluidoEm`, `excluidoPor`, `historico`), que o código antigo ignora. Nenhuma
migração, nenhuma renomeação, nenhum campo removido.

## Diagnóstico (o que encontrei lendo o código)
1. **Perda de dados entre usuários.** Cada ação na Lista acaba em `setDbAndSave` → POST do
   **documento inteiro** (7+ MB, `SYNC_POST_TIMEOUT_MS=120000`). No 4G da loja o envio demora,
   cai, ou fica pendurado, e enquanto isso o aparelho não recebe o que os outros fizeram. É o
   sintoma que o próprio `listaSync.test.js` descreve.
2. **Tombstones estourados.** `listaDeletedIds` está com **5000 itens = o limite**
   (`.slice(-5000)` em ~10 lugares do App.tsx e no `mergeFromServer`, linha ~2209). Daqui em diante
   cada exclusão empurra a mais antiga para fora; um aparelho com dados velhos pode **ressuscitar
   itens excluídos ou arquivados**.
3. **Apagamento automático de 48 h** (`listasOciosas`/`horasAteApagar`, ~linha 11522): apaga itens
   sem desfazer. Contradiz "nada se perde".
4. **Órfãos "de hoje"** usam `today()` (dia civil). Com o corte às 12h isso classifica errado os itens
   lançados entre 0h e 12h.

---

## Etapa 1 — Base (prioridade máxima)
1. **Gravação item a item.** Nova rota `POST /api/dados/<emp>/lista-op` (antes do handler genérico de
   `/api/dados/`, mesma sessão via `barrouDados`). Corpo: `{ ops: [{ tipo: 'add'|'update'|'remove'|'marcar', item, id, campos, por, em }] }`.
   O servidor lê o arquivo, aplica as operações em `listaCompras` / `listaDeletedIds` com a regra de
   carimbo do §3 (`updatedAt` maior vence), grava (mesma rotina de backup do POST) e responde com o
   recorte da lista (`recorteDaLista`). Payload de poucos KB.
   No app, `saveItem`, editar, excluir, marcar comprado e quantidade passam a chamar essa rota
   **primeiro** (resposta em ~100 ms); o estado local é atualizado otimista, e o POST do documento
   inteiro deixa de ser necessário para a Lista. Manter `listaSync.test.js` verde, atualizando os
   asserts que travam o caminho antigo só onde for a intenção desta mudança.
2. **Fila offline.** Operações que falharem vão para `localStorage` (`_listaOpsPendentes`) com
   reenvio automático (ao voltar `online`, a cada 10 s e no `visibilitychange`). Item pendente
   aparece com ⏳. Operações são idempotentes (o `id` do item nasce no aparelho).
3. **Ciclo das 12h.** Funções puras em `src/listaCiclo.js` (com teste): `diaDaCompra(dataHora)`
   (≥12h → dia seguinte), `nomeDaCompra`, `proximoCorte`. Um timer **no servidor** (setInterval de
   1 min) arquiva a lista aberta ao passar das 12h, com a mesma forma de `pedido` que
   `arquivarLista` gera hoje (`id: "arq-"+listaId`, `automatico: true`, `data` = dia da compra) e abre a
   nova (`proximaListaId`). Idempotente: se já arquivou, não faz de novo. Substituir o uso de
   `today()` na separação de órfãos por `diaDaCompra`.
4. **Trocar o apagamento de 48 h por arquivamento** (vai para `pedidosLista` com
   `automatico: true`). Nada mais é apagado sem passar pelo Arquivo.
5. **Lixeira + desfazer.** Ao excluir: snackbar "Desfazer" por 10 s. O item excluído é guardado em
   `listaLixeira` (campo novo, opcional: `{ item, excluidoEm, excluidoPor }`, máx. 30 dias) e pode ser
   restaurado pela tela "Lixeira" (subaba nova em Lista).
6. **Tombstones sem perda.** Subir o limite de `listaDeletedIds` para 30000 em todos os pontos
   (constante única `MAX_TOMBSTONES`, servidor e app) **e** podar só ids que não existem mais em
   nenhum `listaCompras` dos backups recentes. Teste: arquivar 6000 itens não ressuscita nenhum.

**Aceite da etapa 1:** dois navegadores (um em 4G lento simulado no DevTools) lançam 20 itens cada
ao mesmo tempo → os 40 aparecem nos dois em < 2 s. Derrubar a rede de um, lançar 5 itens, voltar
→ os 5 sobem sozinhos. Às 12h00 a lista vira "Compra de DD/MM" no Arquivo e abre uma nova.

## Etapa 2 — Ao vivo + modo compra
1. **Ao vivo:** o SSE já existe (`sseClientes`, `avisarMudanca`). Com a etapa 1, a resposta do
   `lista-op` + o recorte deixam a tela atualizada em todos os aparelhos. Acrescentar o aviso
   discreto "Lopes adicionou Água mineral" (toast de 3 s; nunca para as ações do próprio usuário).
2. **Modo compra:** botão "Modo compra" na lista aberta → tela cheia, agrupada por **rua** (ordem de
   `listaRuas`), cartões grandes, 1 toque = comprado, campo opcional "preço pago" e "quantidade
   comprada" (`quantidadeComprada` já existe; `precoPago` é campo novo opcional). Barra no rodapé com
   progresso e total real × estimado. Funciona offline (usa a fila da etapa 1).

## Etapa 3 — Catálogo protegido + sugestões
1. **Histórico de produtos:** toda alteração em `produtosLista` grava em `p.historico` (campo novo,
   opcional, últimas 20: `{ em, por, de, para }`). Tela do produto mostra o histórico com "Restaurar".
   Alteração de produto também passa por rota leve (`/api/dados/<emp>/catalogo-op`), com a mesma
   regra de carimbo — o catálogo é compartilhado entre as empresas (§1).
2. **Anti-duplicado:** ao cadastrar, comparar nome normalizado (sem acento, caixa, espaços, plural
   simples) e sugerir o existente: "Já existe *Água mineral*. Usar este?".
3. **Sugestões:** botão "Sugerir" na lista aberta: (a) itens comprados em ≥ 3 das últimas 6 compras
   do mesmo dia da semana (de `pedidosLista`), (b) matérias-primas com `estoqueAtual` abaixo do
   mínimo, (c) itens que estavam na última compra e não foram comprados. Um toque adiciona.

## Entrega
Ao fim de cada etapa: resumo do que mudou, testes novos, e como desfazer (arquivos de backup).
