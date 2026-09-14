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
src/consumoTeorico.js consumo teórico de insumos a partir das vendas (com testes)
src/tipoInsumo.js     o que o item é e o que a venda faz com ele (com testes)
src/movimentoEstoque.js  entrada/saída/ajuste/produção manual (com testes)
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
itensVendidos            [{id, data, origem, itens:[{cod,nome,un,qtd,valor}]}] — produtos
                         vendidos por dia, AGREGADOS por produto. Fora de `vendas`
                         de propósito: não entra em nenhum cálculo de faturamento
tipoInsumo               {foldNome(insumo): "producao"|"revenda"|"interno"} — o que o
                         insumo É. Marcado em Compras → Insumos; quem não é
                         marcado cai na regra por categoria contábil
                         (src/tipoInsumo.js, com testes)
mapaProdutoFicha         {foldNome(produto): {modo:"ficha"|"produto"|"auto"|"ignorar",
                         fichaId|prodId, fichaNome|prodNome, origemAprendizado,
                         ultimaAtualizacao}}  — ver §6, "Produto vendido → compra"
```

### Ponte Eclética Food (`ecletica-agent/`)

Roda no PC do caixa da Confraria, lê os XML de NFC-e do Eclética e envia pro
`/api/venda-pdv`. Sem API. Os detalhes que não são óbvios estão no README de lá;
o que importa saber daqui:

- venda do caixa entra com **origem `pdv_ecletica`**, separada do `pdv` do
  `delivery-backend` — o endpoint SUBSTITUI o registro do dia, então duas fontes
  na mesma origem se apagariam a cada ciclo
- `formas` (dinheiro/credito/debito/pix/pendura/outros) acompanha o dia;
  **pendura entra no total e fica FORA de dinheiro e maquininha**, mesma regra
  do fiado no `delivery-backend`
- itens do dia alimentam Vendas → Relatório (Produtos, ABC, Margem), que antes
  liam só `recibosVenda` e nunca tinham visto a venda do balcão

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

### Produto vendido → compra: dois caminhos, não um

Tratar os dois como a mesma coisa é o que faz o CMV não fechar.

```
PRODUZIDO   venda ─ mapaProdutoFicha ─► ficha técnica ─ insumos[].mpId ─►
            matéria-prima ─ produtosLista.mpVinculados ─► compra
REVENDA     venda ─ mapaProdutoFicha (modo "produto") ─► PRODUTO DA LISTA ─
            mpVinculados ─► matéria-prima ─► compra
```

O destino da revenda é o **produto da lista de compras**, não a matéria-prima.
A lista é o cadastro que o dono mantém (nome, categoria, rua); a matéria-prima
nasce das entradas. Um produto da lista costuma ter VÁRIAS matérias-primas
vinculadas (marcas do mesmo item) — só a soma delas responde "quanto comprei
disso".

A corrente do PRODUZIDO já existe elo a elo (`autoVincularInsumosCompra` casa
matéria-prima com produto da lista sozinho quando o nome bate). O cálculo que a
percorre está em **`src/consumoTeorico.js`** (com testes) e aparece em
Vendas → Relatório → **Consumo Teórico**.

Duas contas ali erram em silêncio, e por isso moram fora do `App.tsx`:

- `insumos[].quantidade` é da **receita inteira**; `porcoes` diz quantas unidades
  ela rende. Sem dividir, uma receita que rende 50 pães acusa 50× o polvilho
- ficha é escrita em g/ml, compra vem em kg/l. `converterQtd` só converte dentro
  de massa e volume e devolve **null** fora disso — quantas unidades tem um
  pacote é cadastro (`unidadesPorEmbalagem`), não tabela

REVENDA (água, refrigerante, cerveja, industrializado) não tem ficha e não é
"ignorar": o que se vende é o que se compra. Comparação em
Vendas → Relatório → **Revenda × Compras**.

### Item com saldo: cinco tipos, uma coleção

`materiasPrimas` é **"item com saldo"**, não só insumo: os produtos do cardápio
do Eclética vivem nela também. Criar uma coleção separada pros 281 produtos
seria a QUARTA lista de produtos do sistema (`produtosLista`, `materiasPrimas`,
`produtosProducao`) e obrigaria a reescrever ajuste, contagem, extrato e
movimentações pra ela. **Não crie.**

```
insumo     comprado, vira ingrediente        farinha, queijo em kg
revenda    comprado e vendido como está      água, coca, cerveja
produzido  feito na cozinha, tem ficha       bolo, pão de queijo
dose       porção vendida à parte            fatia de queijo, bacon
interno    não sai por venda                 detergente
```

**O que a VENDA faz** (`baixaDaVenda`, em `src/tipoInsumo.js`):

| tipo | baixa |
|---|---|
| revenda, produzido | o **próprio** saldo |
| dose | o **insumo pela ficha** — não se estoca "fatia de queijo" |
| insumo, interno | nada |

⚠️ `produzido` baixa o próprio saldo e **não** a ficha: o insumo já saiu quando
a produção foi registrada. Explodir a ficha na venda também contaria a farinha
duas vezes, e o erro só apareceria na contagem física.

⚠️ `"producao"` foi o nome de `insumo` numa versão anterior. `LEGADO` em
`tipoInsumo.js` traduz na leitura — não migre dado por isso.

Quem não é marcado segue a **categoria contábil** (`tipoPadraoPorCategoria`):
"Bebidas para revenda" → revenda; Proteínas/Hortifruti/Laticínios/Mercearia →
insumo; limpeza e descartáveis → interno. **"Outros" não tem palpite de
propósito** — vira pendência na tela em vez de um chute que ninguém revisa.

Isso é o que torna a **revenda automática**: `vinculoDoProduto` casa o produto
vendido com o produto da lista de mesmo nome **só quando o insumo dele está
marcado como revenda**. A trava não é detalhe — o "Café" da venda é a bebida
pronta e o "Café" da lista é o pacote de grão; sem ela, o pacote baixaria a cada
xícara vendida.

⚠️ A conversão embalagem→unidade (`unidadesPorEmbalagem`) só é cobrada de
**revenda**: é o que traduz "vendi 40 latas" em "saiu 3,33 caixas". Insumo de
produção sai em g/kg pela ficha, que tem a própria conversão (`porcoes`).

### Estoque → Saldo · Manutenção · Produtos Eclética

- **Saldo Estoque** — todos os itens com saldo, filtro por tipo. Abre em
  "Produtos" (revenda/produzido/dose); insumo e interno ficam atrás do filtro
- **Manutenção de Produtos** — Produção · Entrada · Saída · Ajuste. Lista só
  **produto do Eclética** (tem `codigoEcletica` ou tipo vendável); ajuste de
  INSUMO continua em Estoque → Inventário. Misturar os dois faria a busca
  devolver "Queijo" (o kg) junto com "Queijo fatia" (a dose), e a pessoa
  baixaria do item errado. `src/movimentoEstoque.js`, com testes
- **Produtos Eclética** — importa o cardápio. A marcação é **por ITEM**; o botão
  do grupo é só um atalho que escreve em todos os itens dele, para não existirem
  duas fontes de verdade na hora de importar. Cada grupo abre e mostra os
  produtos com código. Item sem marcação é importado assim mesmo e pode ser
  resolvido depois em Saldo Estoque. Produto que já existe não é duplicado;
  entra com saldo **zero**

⚠️ O arquivo do Eclética **não é uma tabela**: é o relatório
`RelCadProdutosT.rpt`, em que CADA linha repete os rótulos das colunas, depois
um bloco de campos vazios, depois os dados, e no fim o rodapé (nome do .rpt,
data, hora, "Página"). Lido como CSV comum dá 281 cabeçalhos e zero produtos.
`lerProdutosEcletica` descarta rótulos, vazios e rodapé em vez de fixar a
posição 24 — fixar quebra se o Eclética acrescentar uma coluna. Planilha comum
com cabeçalho também é aceita.

### Identidade do item: o CÓDIGO, não o nome

Produto importado tem `codigoEcletica`, e **é ele que amarra tudo**: a marcação
de tipo (`chaveTipo` devolve `cod:<código>`), a conferência da reimportação e o
casamento com a venda (o XML da NFC-e traz `cProd`, guardado em
`itensVendidos[].itens[].cod`).

Renomear o produto no Gestão — ou no Eclética — **não** desfaz nada. Insumo
comprado não tem código e continua pelo `foldNome`, como o resto do sistema.

`tipoDoInsumo` tenta `cod:` e cai no nome depois, então quem foi marcado antes
de o código existir continua valendo — sem migração de dado.

Editar e excluir produto ficam em **Saldo Estoque** (toque na linha). Código
repetido é recusado: dois itens com o mesmo código fariam a venda baixar do item
errado, e nada na tela denunciaria.

**PRODUÇÃO tem dois lados**: entra o produto e saem os insumos da ficha, no
mesmo `grupoId` — separado, um lado some e ninguém percebe. Reaproveita
`consumoTeorico` (que já divide pelo rendimento) em vez de repetir a divisão.

⚠️ Por decisão do dono, produzir **nunca é bloqueado**: sem ficha, sem insumo
cadastrado ou sem conversão de unidade, a produção é registrada e o que não foi
baixado vira aviso. Travar a cozinha porque o cadastro está incompleto é pior.

⚠️ `ajuste` recebe o saldo **CONTADO**, não a diferença — é como a contagem
física funciona. Misturar os dois sentidos no mesmo campo é erro clássico de
inventário.

### Estoque → Saídas por venda

Tudo que liga venda a estoque num lugar só, em três abas na ordem de uso:
**1. Vínculos** (cadastro, uma vez) → **2. Registrar** (a cada período) →
**3. Conferência** (consumo teórico + revenda × compras).

⚠️ Isto já esteve espalhado em quatro abas dentro de Vendas → Relatório, que
chegou a ter quinze. Relatório é lugar de OLHAR; tela que mexe em saldo não mora
lá. Não devolva nada pra lá.

A aba Registrar tem **UM botão**. A separação revenda→PDV / insumo→Gestão é
detalhe de implementação — o sistema sabe qual é qual pelo vínculo, e perguntar
isso a cada uso foi exatamente o que deixou a tela confusa.

⚠️ Houve uma versão em que a revenda baixava no PDV (`/api/stock/venda-externa`).
Foi **removida**: por decisão do dono o saldo do cardápio passou a viver no
Gestão, e manter os dois significaria a mesma lata em dois sistemas.

Grava `movEstoque` tipo `saida` e desconta `materiasPrimas[].estoqueAtual` — o saldo mora em **`estoqueAtual`**, não em
`estoque`.

- **um movimento por dia e por insumo**, com id determinístico
  (`vsaida-<data>-<mpId>`). É o que torna reprocessar seguro: o agente reenvia
  ontem a cada ciclo, e corrigir uma ficha deve REFAZER o dia, não somar
- `aplicarBaixaVendas` trabalha por **diferença** contra o que já foi baixado.
  Baixou 2,0 kg e a ficha corrigida pede 1,6? Devolve 0,4 ao estoque
- revenda com várias marcas: tira primeiro de quem tem mais saldo e cascateia;
  se ninguém tem, joga tudo na primeira e deixa **negativo** de propósito
- `recibosVenda` entra na baixa: são vendas reais e não descontam em nenhum
  outro lugar
- **Desfazer** varre os `vsaida-` GRAVADOS no período e manda zero pra cada um —
  não o que seria calculado agora. Produto desvinculado depois da baixa sumiria
  do cálculo e deixaria movimento órfão segurando estoque
- **Aplicar reconcilia o período**: além do que calcula, manda zero para todo
  `vsaida-` do período que saiu do cálculo. É o que devolveu o estoque da
  revenda quando ela migrou pro PDV, e o que corrige um produto desvinculado
  sem exigir que alguém lembre de desfazer antes

⚠️ `Configurações de PDV → Estoque` e `Estoque` (menu) mostram bancos
DIFERENTES: o primeiro é o PostgreSQL do `delivery-backend`, o segundo é o JSON
do Gestão. Depois desta divisão, revenda só se mexe no primeiro e insumo só no
segundo — se um produto aparecer nos dois com saldos diferentes, é sinal de
vínculo duplicado, não de bug de sincronização.

⚠️ Quantidade vendida é em unidade individual; compra costuma ser em embalagem.
A conversão é `materiasPrimas[].unidadesPorEmbalagem`. Sem ela, comparar
"40 vendidas" com "7 compradas" inventa um rombo — por isso a tela avisa em vez
de mostrar o número quando a conversão não está configurada.

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
