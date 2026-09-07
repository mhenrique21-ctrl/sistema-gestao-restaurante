# App Gestão — contexto para IA

Sistema de gestão da **Confraria Café** e da **Seama**. Este arquivo é lido
automaticamente pelo Claude Code ao abrir o projeto.

Mantenha-o atualizado junto com o código: várias especificações escritas sem
consultar o código real partiram de premissas erradas, e a seção 1 existe
justamente por isso.

---

## 1. Fatos que quase toda spec erra

| Premissa comum | Realidade |
|---|---|
| O arquivo é `app-gestao.jsx` | É **`src/App.tsx`** (TypeScript/TSX), ~20 mil linhas, arquivo único |
| `db.config[empresa].x` | **Não existe.** O `db` JÁ é o da empresa ativa — aninhar de novo duplica |
| Empresas são `"confraria"` / `"seama"` | São **`"CONFRARIA"`** e **`"SEAMA"`**, maiúsculas |
| Dados nunca são compartilhados entre empresas | **`produtosLista` é compartilhado de propósito** (ver `applyBothProdutos`) |
| Existe `db.rh` / `db.financeiro` | Não. Folha vem de **`db.funcionarios`**; financeiro é **`db.contas`** |
| Categoria tem campo de tipo/módulo | **Não tem campo nenhum.** São strings puras; todo vínculo é estrutura à parte, ligada por nome |

---

## 2. Arquitetura

```
src/App.tsx           o app inteiro (React, arquivo único)
src/PainelTV.tsx      painel ao vivo para TV
src/CardapioTV.tsx    cardápio em loop para TV
src/ConfigPanel.tsx   configuração visual
new_server.js         API Node (sem framework), serve o build e faz proxy pros PDVs
mergeDocument.js      fusão de documento no servidor (com testes)
mergeListaCompras.js  fusão específica da Lista de Compras (com testes)
```

Stack: React + Vite + TypeScript. Backend em `http` puro, sem framework.
Persistência: **arquivos JSON por empresa** em `dados/confraria.json` e `dados/seama.json`.

### Sistemas irmãos (mesmo repositório)

| Sistema | Pasta | pm2 | Endereço |
|---|---|---|---|
| App Gestão | raiz | `app-gestao` | gestao.confrariacafe.com |
| Delivery / PDV Confraria | `delivery-backend/` | `confrari` | pedidos.confrariacafe.com |
| Gestão de Delivery (admin) | idem | idem | erpdelivery.confrariacafe.com |
| PDV Seama | `seama-backend/` | `seama-backend` | seama.confrariacafe.com |
| Loja do cliente (SPA) | `delivery-app/` | — | servida por Nginx |

---

## 3. Sincronização — a parte mais delicada

O app roda em vários aparelhos ao mesmo tempo, com poll a cada ~100ms.
**A maioria dos bugs históricos do sistema nasceu aqui.**

### O padrão

```
setDbAndSave(fn)  → aplica local (otimista) → busca servidor → funde → POST
                    USAR SEMPRE que a mudança precisa persistir
setDb(fn)         → só estado local; depende do auto-save genérico, que PODE PULAR
                    a gravação se coincidir com outro save em andamento
```

### A armadilha que já mordeu seis vezes

`mergeFromServer` monta `next[empresa] = { ...servidor, ...campos fundidos }`.
A base é o **servidor**. Campo novo que não estiver na lista de fusão explícita vem cru
do servidor — e o poll **reverte** a gravação antes do POST confirmar. O sintoma é sempre
o mesmo: *"eu marco e volta sozinho"*.

**Ao adicionar qualquer campo novo em `db`, registre nos dois lugares:**

1. `mergeFromServer` em `src/App.tsx`
2. `mergeDocument.js` — o documento mesclado nasce do `incoming`, então um aparelho com
   bundle antigo apagaria o campo

### Qual fusão usar

| Formato do campo | Fusão |
|---|---|
| Array com `id` | `mergeArrayById` + entrar em `MERGEABLE_FIELDS` |
| Mapa `{chave: valor}` | união com local vencendo por chave |
| Mapa aninhado | união **em dois níveis** (ex.: `budgetCompras`) |
| Lista que pode ser esvaziada | precisa de **tombstone** (`*Deleted`), senão a união ressuscita o item |

Exclusão usa o tombstone genérico `_listaDeletados` (itens com `id`) ou uma lista própria
(`listaCatDeleted`, `categoriasDeleted`, `categoriasProducaoDeleted`).

Ao recriar algo que foi excluído, **limpe o tombstone** — senão a fusão apaga de novo.

---

## 4. Estrutura do `db` (por empresa)

```
vendas              lançamentos diários por canal (ver §6)
compras             entradas de estoque; categoria CONTÁBIL (ver §5)
contas              financeiro. tipo, status, origem, vencimento, categoria
fornecedores        materiasPrimas      fichasTecnicas
funcionarios        faltas  adiantamentos  consumacoes  encargos        ← RH
listaCompras        listaCategorias  listaCatOrdem  listaCatDeleted     ← Lista de Compras
produtosLista       catálogo — COMPARTILHADO entre as duas empresas
pedidosProducao     produtosProducao  itensProducaoPendentes  categoriasProducao
encomendas          clientesEncomenda  anotacoes
movEstoque          normalizacoes  recibosVenda  recibosEntrega
categorias          categorias do Financeiro — [{nome, apareceNaSangria}]
usuarios            config             deletedIds
```

Campos mais recentes (todos já nas duas fusões):

```
dicionarioClassificacao  {foldNome(item): {categoria, origemAprendizado, ultimaAtualizacao}}
mapaCategoriaDre         {foldNome(cat): "folha" | "despesa" | "fora"}
giroInsumo               {foldNome(insumo): "perecivel" | "seco"}
budgetCompras            {periodo: {categorias: {cat: {orcado, sugerido, ajustadoManualmente}}}}
projecoesCompra          [{id, semanaProjetada, janelasBase, itens[], totalEstimado}]
categoriaFinanceiroSangria  {categoriaFinanceiro: categoriaSangriaPDV}
categoriasDeleted        tombstone das categorias do Financeiro
```

---

## 5. Categorias — dois universos separados

O ponto que mais gera confusão.

| | Lista de Compras | Compra (contábil) |
|---|---|---|
| Campo | `produtosLista[].cat` | `compras[].categoria` |
| Valores | 19 padrão + criadas pelo usuário | 8 fixas |
| Para quê | organizar o que comprar, por corredor | medir CMV |

```js
CATS_CMV     = ["Proteínas","Hortifruti","Laticínios","Mercearia/Secos",
                "Bebidas para revenda","Descartáveis de consumo do produto"]
CATS_NAO_CMV = ["Material de limpeza e higiene","Outros"]
ehCategoriaCmv(cat)  // testa inclusão em CATS_CMV
```

As 19 operacionais (`CATS_DEFAULT`): carnes, hortifruti, laticínios, grãos, temperos,
proteína, bebidas, embalagens, descartáveis, material de limpeza, polpas, mercearia básica,
farinhas, cafés e complementos, chocolates, latas/caixas/temperos, molhos, massas, outros.

Compra com categoria antiga aparece em **Compras → Reclassificar**; a original fica em
`categoriaOriginal`.

### Onde ficam as "marcações"

Nenhuma dentro da categoria:

| Comportamento | Estrutura |
|---|---|
| Entra no CMV? | `CATS_CMV` (inclusão no array) |
| Vai pro PDV? | `db.config.categoriasParaPdvDesligadas` — **lista de EXCLUSÃO**, nasce ligada |
| Linha da DRE | `db.mapaCategoriaDre` |
| Sangria do PDV | `db.categoriaFinanceiroSangria` |

### Comparação de nome

Sempre `foldNome` — remove acento, colapsa espaço, minúsculo. **Nunca criar outra
normalização.** Renomear categoria quebra vínculos (a ligação é por nome, não por id):
quem renomeia precisa reescrever os registros que a citam.

---

## 6. Módulos e telas

### Vendas
Lançamento diário **por canal de pagamento**, não por produto — isso limita qualquer
feature que precise de venda por item.

Campos por dia: `maquininha`, `dinheiro`, `ifood`+`ifoodTaxa`+`ifoodLiq`,
`99food`+`nfoodTaxa`+`nfoodLiq`, `delivery`, `total`, `origem`.

`origem` distingue lançamento manual, `"pdv"` (sincronizado) e `"recibo_venda"`. Os três
coexistem no mesmo dia de propósito, e a fusão chaveia por `data+origem`.

### Compras
Entradas · Cupom IA · NF-e · Histórico · Fornecedores · Insumos · Consumo · Budget ·
Classificar · Reclassificar.

- Classificação automática: regras duras de limpeza > dicionário aprendido > palpite por
  palavra-chave > "Outros" (`classificarItem`)
- Budget por categoria com sugestão híbrida e `statusPace` ok/warn/over

### Financeiro
Contas · + Novo · DRE · Categorias. A DRE tem toggle **Semanal / Mensal / Período livre**;
em modo semanal, contas de grupo recorrente mensal entram **rateadas por dia**.

### Estoque
Inventário · Contagem · Análise · Movimentações · Projeção de compras, que tem dois modos:

- **Por ritmo**: janela de 90 dias, `consumo/dia × N dias − estoque`
- **Semanal**: média das últimas N semanas **segunda a sábado**, separada por giro
  (perecível/seco), flag de variação > 30% e snapshot conferível depois

### Outros
Lista de Compras · Produção (fichas técnicas) · Encomendas · RH · Fluxo de Caixa ·
Configurações de PDV (ponte com os dois PDVs) · Cardápio TV · Backups

---

## 7. Períodos — três conceitos diferentes

Não confundir:

| Função | Semana | Onde |
|---|---|---|
| `isoWeekInfo` | segunda a **domingo** (ISO) | DRE, Budget |
| `semanaComprasSegSab` | segunda a **sábado** (loja fechada domingo) | Projeção semanal |
| `ritmoDoPeriodo` | fração do período decorrida | projeções |

`fatorRitmo = dias decorridos / dias do período`. Serve pra esticar o realizado até o fim
do período — gastar 60% do budget é ótimo no dia 25 e alarmante no dia 3.

---

## 8. Impressão

`gerarRelatorioHTML(titulo, empresa, conteudo)` monta o documento; `abrirRelatorio(html)`
abre em nova aba e avisa se o pop-up for bloqueado.

Regras aprendidas na marra:

- O HTML do relatório abre em **outra janela, sem o CSS do app** → `var(--token)` **não
  funciona ali**. Usar hex literal.
- Navegador não imprime fundo colorido por padrão → texto claro sobre fundo colorido some
  no papel. Usar texto escuro, e `print-color-adjust:exact` onde o fundo carrega informação.
- Status nunca só por cor: barra **e** rótulo escrito — muita impressão sai em P&B.
- Timbre vem de `db.config.impressao` (nome, logo, razão social, CNPJ, endereço, contato).

---

## 9. Cores

Paleta **Confraria**: cognac sobre creme, definida em `.app-root`.

```
--bg #FAF6F0   --bg3 #FFFFFF   --border #E2D6C7
--text #2A211B  --text2 #63544A  --text3 #75665B
--acc/--btnPrimary #8A5227      --success #146B42
--danger #A32B24  --warning #8A5A00  --info #1C5A9E
```

**Regra:** cor saturada só em preenchimento (barra, ícone, botão); **texto sempre na versão
escurecida**. Todo par foi medido pelo WCAG contra os dois fundos reais (card branco e creme
da página); mínimo 5.12:1.

Ao propor cor nova, meça contra **os dois fundos** — medir só contra o branco já deixou
passar um texto que reprovava sobre o creme.

⚠️ **Pendente:** ~1.373 cores fixas ainda no código — 818 em JSX (podem virar token) e 555
dentro do HTML dos relatórios (não podem, ver §8). Existem funções que devolvem cor usadas
nas duas pontas, então substituição cega quebra a impressão.

---

## 10. Convenções

- **Comentário explica o porquê, não o quê.** O código tem comentários longos documentando
  bugs reais já corrigidos — não remover, eles evitam regressão.
- Toda gravação que precisa persistir carimba `atualizadoEm` (a fusão desempata por
  timestamp).
- `MoneyInput` para dinheiro; `parseMoney` / `fmtMoney` para converter.
- Antes de commitar: `node --check new_server.js && npm run build && npm test`.
- `npm test` (node --test) cobre as fusões — o lugar certo pra travar regressão de sync.

---

## 11. Deploy

```bash
# App Gestão
cd /var/www/app-gestao && git pull origin <branch> && npm install && npm run build && pm2 restart app-gestao

# Delivery / admin
cd /var/www/sistema-gestao-restaurante && git pull origin <branch> && pm2 restart confrari

# PDV Seama
cd /var/www/sistema-gestao-restaurante && git pull origin <branch> && pm2 restart seama-backend
```

VPS Hostinger. Nginx com um bloco por subdomínio, todos com certbot.
