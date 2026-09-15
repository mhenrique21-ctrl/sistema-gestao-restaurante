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
src/folhaRh.js        folha: o que é desconto, o que é desembolso (com testes)
src/faltaClt.js       desconto de falta: o dia E o DSR, pela CLT (com testes)
src/nfeImportadas.js  quais NF-e já entraram, pela chave de 44 dígitos (com testes)
```

Stack: React + Vite + TypeScript. Backend em `http` puro, sem framework.
Persistência: **arquivos JSON por empresa** em `dados/confraria.json` e `dados/seama.json`.

Agentes que rodam fora do servidor:

```
ecletica-agent/    lê os XML de NFC-e do Eclética no PC do caixa (ver §4)
impressora-agent/  captura a comanda do 99Food no meio do caminho pra impressora
```

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

### Ponte de impressão 99Food (`impressora-agent/`)

O 99Food não abre API pra loja ler o próprio pedido; o que existe é a comanda
que já sai impressa na cozinha. O agente fica **entre** o app e a impressora
(TCP 9100), guarda o trabalho e **repassa os mesmos bytes** pra impressora real.

⚠️ Intermediário, nunca substituto: a cozinha depende daquele papel, e o
primeiro pedido sem comanda acabaria com a confiança na ponte. Falha no repasse
vira aviso, não interrupção da captura — o `.bin` fica guardado pra reimprimir.

A impressora da Confraria é **USB**, e isso decide a montagem:

- **repasse** — porta USB não se abre como arquivo (ao contrário da LPT antiga).
  O único caminho pra bytes crus é o **compartilhamento** do Windows, por
  `copy /b` para `\\localhost\<share>`. ⚠️ O `/b` não é enfeite: sem ele o
  `0x1A` do ESC/POS é lido como fim de arquivo e a comanda sai cortada no meio,
  sem erro nenhum. `--impressoras` pergunta o nome ao Windows em vez de adivinhar
- **captura** — modo `pasta`: uma segunda impressora com driver Generic/Text Only
  numa **Local Port** apontada a um arquivo fixo. ⚠️ Porta `FILE:` não serve:
  abre diálogo pedindo o nome a cada impressão. Como o nome é sempre o mesmo, o
  agente lê, apaga e guarda a assinatura (tamanho+mtime) do que já leu — senão o
  mesmo pedido viraria duas comandas
- modo `rede` (o app aponta pra um IP, porta 9100) continua para quem tiver
  impressora de rede; só ele repassa em fluxo, o USB espera o trabalho inteiro

⚠️ Grava **`.bin` cru + `.txt` legível**. O cru não é redundância: se a
impressora usar outra tabela de caracteres, ou o leitor melhorar, é ele que
permite reler os pedidos antigos sem esperar pedido novo (`--ler`).

A decodificação mora em **`impressora-agent/escpos.js`** (com testes), fora do
agente, porque é ela que muda quando o layout muda e é a única parte testável
sem impressora na mesa. Ela converte **CP850** (térmica não fala UTF-8 — um
byte por acentuado; lido como UTF-8, nome de produto com lixo não casa com o
cadastro) e **pula os comandos**: parâmetro não consumido vira caractere solto
colado no nome do item, e logo raster (`GS v 0`) não pulado pelo tamanho
declarado vira páginas de sujeira.

⚠️ A comanda do 99Food tem fonte proporcional e caixa de canto arredondado —
térmica não desenha isso, é o app mandando a comanda PRONTA como imagem. Por
isso o extrator não só pula o raster: devolve as faixas e o agente monta um
`.png` (`png.js`, PNG de 1 bit escrito à mão sobre `node:zlib` — "npm install"
no PC do caixa é uma coisa a mais pra dar errado às 20h). Sem isso um trabalho
gráfico não deixaria rastro nenhum de conteúdo.

⚠️ A impressora de CAPTURA usa o **mesmo driver** da térmica, não Generic/Text
Only: assim os bytes capturados são os que a térmica entende e o repasse
reproduz a comanda idêntica. Text Only só como plano B, se o `.txt` sair vazio.

**Leitura do pedido: `pedido99.js`** (com testes), escrito em cima da comanda
real #871001 — não de layout imaginado.

⚠️ Rótulo é reconhecido por um **trecho SEM acento** ("verifica", "endere",
"observa"), nunca pela frase inteira. Numa captura de teste a impressora
entregou "Código de verificação" como "Cudigo de verificaúo": comparando a frase
toda o rótulo sumia e o endereço engolia o resto da comanda, itens inclusive.

⚠️ **"Pagamento via 99Food" e "Cobrar do cliente" são dinheiros DIFERENTES** — o
que a plataforma repassa e o que o entregador recebe na porta. Somar dobra o
faturamento do dia; trocar um pelo outro joga dinheiro de caixa na conta a
receber do 99Food. `conferirPedido99` acusa quando não fecham com o total.

⚠️ Linha que não casa com âncora nenhuma volta em `naoEntendido` — pendência na
tela, nunca palpite. Item é testado ANTES dos rótulos: "1x Desconto especial
R$5,00" é item, e deixar o rótulo ganhar viraria abatimento.

**Estado:** captura, lê e grava `.bin`/`.txt`/`.png`/`.json`; **não envia pro
Gestão**. O que falta não é código — é decidir em que coluna de Vendas entra
cada um dos dois dinheiros. O iFood usa o mesmo mecanismo e não foi ligado.

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

⚠️ **Quem fecha o modal de conciliação é o próprio modal** (`onConfirm` em
`ConciliacaoImportModal`), não cada função de importar. São quatro caminhos até
ele — Cupom IA, XML, NF-e da SEFAZ e "importar todas" — e três fechavam sozinhos
enquanto o de importar UMA NF-e esquecia: a importação acontecia, a nota saía da
lista, e a tela ficava aberta como se nada tivesse sido feito. Quem clicasse
"Concluir" de novo importava a MESMA nota outra vez — compra duplicada, CMV
errado, nada denunciando. `checkDuplicataCompra` não pega: ela roda ANTES da
conciliação. O botão também trava no primeiro clique, porque o modal só some no
render seguinte.
- Budget por categoria com sugestão híbrida e `statusPace` ok/warn/over

#### NF-e da SEFAZ: a lista mostra só o que FALTA importar

⚠️ **A limpeza da lista NÃO é memória.** Ela apaga a nota de UMA lista; o botão
**"↩ Do início"** reseta o contador NSU e a varredura devolve tudo — importadas
inclusive. E a remoção do cache é uma chamada de rede: falhando, a nota some da
tela e volta na abertura seguinte.

A memória é a **chave de acesso de 44 dígitos** (`src/nfeImportadas.js`, com
testes): identificador fiscal único, que não depende de nada que a tela faça.
`separarImportadas(db, lista)` devolve `{visiveis, ocultas}` e a tela diz quantas
escondeu — sumir sem explicação faria a pessoa procurar a nota.

⚠️ Lê a chave de **`compras` E de `contas`**. A importação sempre gravou
`chNFe` na conta a pagar e nunca na compra; sem olhar as duas, todo o histórico
anterior voltaria como nota nova. A compra passou a gravar a chave também.

⚠️ Comparação **só pelos dígitos** (`foldChave`): a chave aparece agrupada na
tela e corrida no XML. Chave vazia nunca entra no conjunto — casaria com toda
nota sem chave.

⚠️ **"Importar Todas" checa duplicata por chave, aqui.** `checkDuplicataCompra`
é pulada nesse caminho de propósito (`if(!all && …)` em `importarNFeSefaz`), então
o lote entrava sem verificar nada: bastava usar "Do início" uma vez pra
reimportar tudo — compra e conta a pagar em dobro, CMV errado, nada denunciando.

⚠️ A lista renderizada é um **recorte**, então tudo nela opera por **`nsu`**,
nunca por índice do array: por posição, editar a data de uma nota acertaria
outra.

⚠️ **O auto-fetch de resumo tenta cada chave UMA vez.** O gatilho era
`sefazList.length`, então o ciclo recomeçava a cada mudança de tamanho —
inclusive depois de cada importação. Com 25 resumos eram 25 consultas de 3 em 3
segundos, repetidas a cada abertura da aba: é assim que se chega no **erro 656**
(consumo indevido), que bloqueia por mais de uma hora. A chave é marcada ANTES
da consulta — falha de rede não pode devolvê-la à fila. Sincronizar de novo
limpa a trava, que é um pedido explícito de rebuscar.

⚠️ `sefazVisiveis` é declarado **logo após** `sefazList`, antes de qualquer
`useEffect` que o use: o array de dependências é avaliado durante o render, e
declarar depois dava `ReferenceError` (TDZ) que derrubava a tela inteira. O
build não pega isso.

⚠️ Abrir a aba NF-e **não** consulta a SEFAZ para listar — lê o cache local. Só
o auto-fetch acima consulta.


### Financeiro
Contas · + Novo · DRE · Categorias. A DRE tem toggle **Semanal / Mensal / Período livre**;
em modo semanal, contas de grupo recorrente mensal entram **rateadas por dia**.

### Estoque
Inventário · Contagem · Análise · Movimentações · Projeção de compras.

**Contagem** é agrupada pelo **grupo do Eclética** (BEBIDAS, BOLOS, DOSE EXTRA),
com os grupos **recolhidos** e contador por grupo. Agrupava por categoria
contábil, que serve pra medir CMV e não pra andar pela loja com o celular; e com
742 itens a tela aberta era uma rolagem que ninguém termina.

⚠️ Revenda e dose são contadas **pela MARCA**, na unidade dela — é o que está na
prateleira e é quem tem saldo. A linha mostra o nome do cardápio em cima e a
marca embaixo. Marca de dois produtos do cardápio é deduplicada.

⚠️ Insumo que não é produto do cardápio nem marca de nenhum (farinha,
detergente) cai no grupo **"Insumos fora do cardápio"** e continua contável —
sumir daqui deixaria metade da despensa de fora da contagem física.

Projeção de compras tem dois modos:

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
dose       PARTE de um produto da lista      25 g do queijo mussarela
interno    não sai por venda                 detergente
```

**O que a VENDA faz** (`baixaDaVenda`, em `src/tipoInsumo.js`):

| tipo | baixa |
|---|---|
| revenda | as **marcas** do produto da lista (`distribuirEntreMarcas`) |
| produzido | o **próprio** saldo |
| dose | as **marcas** também, × `qtdPorDose` (1 dose = 25 g do queijo) |
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
- **Manutenção de Produtos** — Produção · Entrada · Saída · Ajuste, em **um
  item** ou **vários de uma vez**. Lista **todo produto do Eclética**, mas cada
  linha opera sobre o item que REALMENTE tem saldo: `produzido` é ele mesmo;
  `revenda` e `dose` viram as **MARCAS** do produto da lista, porque é a marca
  que está na prateleira e é dela que a venda baixa. A quantidade é sempre na
  unidade DA MARCA (4 caixas, 2 kg) — contagem se faz no que está na prateleira,
  não numa unidade convertida.

  ⚠️ Marca vinculada a dois produtos do cardápio é **deduplicada** na lista:
  apareceria duas vezes e a pessoa lançaria em dobro sem perceber.

  ⚠️ Revenda/dose sem marca vinculada aparece **desabilitada**, com o motivo —
  lançar nela gravaria em `estoqueAtual` do nome do cardápio, que nenhuma tela
  lê. Insumo que não é vendido continua em Estoque → Inventário.

  As duas telas mostram o **saldo resultante antes de confirmar** (`4,00 →
  16,00`, vermelho quando negativo). No lote, uma operação/data/motivo valem pro
  bloco e **linha em branco não é zero** — fica de fora.
  `src/movimentoEstoque.js`, com testes
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

### Revenda e DOSE: o saldo mora nas MARCAS, não no produto do cardápio

Estoque → Produtos Eclética → aba **Conciliar**. O produto de revenda do
cardápio aponta para um **produto da LISTA DE COMPRAS** (`prodListaId`), e a
lista já agrega as marcas em `mpVinculados`.

⚠️ **Não funda** o produto do cardápio com um insumo. Houve uma versão que fazia
isso, e ela estava errada: "Suco de abacaxi" pode ser comprado de duas marcas —
fundir com a marca A deixa a B órfã, e a NF-e dela passa a alimentar um registro
que a venda não olha mais. Fusão também não tem desfazer. Vincular grava só um
id; desfazer é escolher outro.

```
VENDA cód 210 "Suco de Abacaxi"
   └─ prodListaId ─► produtoLista "Suco de abacaxi"
                       └─ mpVinculados ─► [marca A, marca B]   ← o saldo mora aqui
```

⚠️ Produto de revenda **não tem `estoqueAtual` próprio**. Saldo Estoque mostra a
soma das marcas (rótulo "somado das marcas") e a edição não oferece ajuste para
ele — gravar um número que a tela nem lê faria a pessoa achar que corrigiu.
Produzido **tem** saldo próprio: o bolo pronto existe e não vem de compra.

`distribuirEntreMarcas` (em `movimentoEstoque.js`, com testes) rateia a venda:
tira primeiro da marca com mais saldo e cascateia. Sem isso, uma marca ficaria
muito negativa enquanto a outra seguia cheia, e nenhuma refletiria a prateleira.
Cada marca converte pela **própria** embalagem — 12 latas podem ser 1 caixa numa
e 2 packs de 6 noutra.

O botão **"+ criar na lista"** cobre a revenda que nunca teve compra: cria o item
na lista e vincula, e a primeira NF-e já cai nele.

**DOSE é uma PARTE do produto da lista**, não uma receita: 1 dose de mussarela
são 25 g do queijo que já se compra. Campos `qtdPorDose` + `unidadeDose` no
item; a baixa é a mesma da revenda multiplicada por `qtdPorDose`, e a conversão
passa a ser de **massa/volume** (g↔kg) em vez de embalagem —
`distribuirEntreMarcas(marcas, total, unidadeDose)`. Marca cuja unidade não
converte fica de fora em vez de baixar número inventado.

⚠️ Dose NÃO precisa de ficha técnica. Houve uma versão que pedia "ficha de uma
linha" pra isso — era cadastro a mais pra dizer a mesma coisa.

Em Saldo Estoque, dose mostra **quantas doses ainda cabem** no que há nas marcas
(`2000 g ÷ 25 g`), não o quilo de queijo: quem abre a tela quer saber quantas
fatias tem, não quanto pesa o bloco.

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

Duas abas: **1. Registrar** (a cada período) → **2. Conferência** (consumo
teórico).

⚠️ Existiu uma aba **Vínculos**, para mapear produto vendido → ficha/produto da
lista, por nome. Foi **apagada**: depois que os produtos do Eclética passaram a
ser importados com `codigoEcletica`, o casamento virou automático pelo código —
o XML da NFC-e traz `cProd` e é o mesmo número. Ela mostrava "0 de 157
vinculados" pedindo trabalho que não existia. **Não recrie.**

`resolverItemVendido(db, {nome, cod})` é o resolvedor único: código → nome →
tipo → ficha. Usado pela baixa, pela Conferência e pela Margem por Produto, para
as três não discordarem entre si.

⚠️ **Passe SEMPRE o `cod`.** A Conferência era a única das dez chamadas que
resolvia só pelo nome — justamente a que confere o resultado das outras. Produto
renomeado no Gestão (a importação preserva o nome editado de propósito) baixava
estoque pela aba Registrar, que casa por código, e sumia do consumo teórico: a
receita caía em "sem ficha" e o **CMV teórico saía menor que o real**, calado.
Por isso `consumoTeorico(vendidos, resolverFicha)` chama
`resolverFicha(p.nome, p)` — o produto inteiro, não só o nome.

⚠️ **Produzido baixa unidade por unidade.** A conversão `unidadesPorEmbalagem`
é cobrada só de REVENDA. A baixa dividia por ela também no `proprio`: bastava
alguém preencher 12 num bolo (o campo é editável pra qualquer matéria-prima, e o
produto do cardápio mora na mesma coleção) pra 12 fatias vendidas baixarem 1 do
saldo. Hoje o campo preenchido num produzido vira **aviso**, não conversão.

⚠️ **O mesmo produto pode aparecer em DUAS linhas** e isso é aceito de
propósito: a venda do PDV traz o código do Eclética e vira a chave `cod:141`; o
recibo de venda **nunca** traz código e vira a chave do nome. Por decisão do dono
as linhas **não são unidas** — juntar mudaria Ranking e ABC de períodos já
conferidos. Ficam **sinalizadas** (`duplicadoDeNome`), com a soma real das duas.
A baixa de estoque some certo: as duas caem no mesmo item.

⚠️ A `key` do React nessas listas leva o código junto (`${cod}|${nome}`): duas
linhas do mesmo nome colidiam na chave, que é o que faz uma sumir ou trocar de
lugar na tela.

⚠️ `baixaDaVenda` nunca devolve `"ficha"` — devolve `lista`, `proprio` ou
`nenhum`. Existia um ramo `modo==="ficha"` com o comentário da regra antiga
(dose via ficha, anterior à decisão de dose baixar as marcas): ramo morto, e o
aviso "é dose mas não tem ficha" era inalcançável. **Não recrie.**

⚠️ O cabeçalho de Vendas → Relatório conta **recibos + PDV**, com as duas
parcelas visíveis. Contava só recibos, então num dia só de PDV dizia "0 recibos ·
R$ 0,00" com um ranking de R$ 120,00 logo abaixo.

O único vínculo que sobrou é **item produzido → ficha técnica**, quando os nomes
diferem: campo `fichaId`, editado em Saldo Estoque junto com nome/código/tipo.
Sem ele, casa pelo nome.

⚠️ `mapaProdutoFicha` ficou **legado** — continua nas duas fusões (remover
quebraria bundle antigo), mas nada mais lê.

⚠️ Isto já esteve espalhado em quatro abas dentro de Vendas → Relatório, que
chegou a ter quinze. Relatório é lugar de OLHAR; tela que mexe em saldo não mora
lá. Não devolva nada pra lá.

A aba Registrar tem **UM botão**, e no topo a estatística de casamento
(casaram por código / por nome / não encontrados, com os nomes). É ela que
substitui a antiga tela de vínculos: em vez de mandar vincular 157 produtos,
mostra os poucos que não casaram.

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

### RH → Financeiro → DRE: desconto ≠ desembolso

`src/folhaRh.js` (com testes). Mora fora do `App.tsx` porque foi aqui que o erro
nasceu, e erro de folha não aparece na tela: aparece na DRE, meses depois, como
"custo de pessoal alto".

**A regra única: cada real aparece UMA vez.**

| item | no holerite | vira conta? |
|---|---|---|
| falta · consumação · encargo descontado (INSS) | desconto | **não** |
| adiantamento | desconto | sim |
| encargo patronal (FGTS) | — | sim |
| bonificação · comissão · salário família | acréscimo | sim, **pela conta de encargos** |
| líquido da folha | o resultado | sim |

⚠️ **Adiantamento é desconto no holerite E desembolso no caixa**, e isso não é
contradição: o dinheiro já saiu antes. Como a folha lança só o líquido, os dois
somam exatamente o salário. Por isso `adiantamento` saiu de `"fora"` para
`"folha"` no `MAPA_DRE_PADRAO` — ficava fora com a justificativa de que "o valor
cheio já aparece em Salários", e não aparecia.

⚠️ **Bonificação e comissão saem pela conta de encargos, não pelo líquido** (por
decisão do dono). Entravam nos dois e a DRE contava em dobro. Por isso
`holerite.liquido` (o que a folha lança) ≠ `holerite.aReceber` (o que o
funcionário leva).

⚠️ O encargo tinha **um campo para os dois sentidos**: era somado como custo da
empresa E descontado do líquido ao mesmo tempo. Agora são `descontado` e
`patronal`. `valor` é o nome antigo de `descontado` — `encargoDescontado()`
traduz na leitura, como o `LEGADO` do `tipoInsumo.js`. **Não migre dado.**
`saveEnc` continua gravando `valor` junto, pra bundle antigo seguir lendo o
desconto (só o `patronal` se perderia num aparelho desatualizado).

⚠️ A falta era calculada no valor a receber e **nunca usada**: não descontava de
quem faltou e ainda virava despesa. Num funcionário de R$ 2.000 com uma falta,
R$ 80 de consumação, R$ 150 de encargo e R$ 200 de bonificação, a DRE mostrava
**R$ 2.466,67** de folha contra **R$ 1.970,00** de desembolso real.

#### Falta: o dia E o DSR — `src/faltaClt.js` (com testes)

Falta injustificada faz perder a remuneração do repouso da semana.<br>
**Lei 605/49, art. 6º** — o repouso é devido a quem trabalhou a semana
"cumprindo integralmente o seu horário". Antes descontava só o dia.

⚠️ **O DSR é por SEMANA, não por falta.** Duas faltas na mesma semana perdem UM
repouso; em semanas diferentes, um cada. Calcular por lançamento ("2 faltas ×
2 dias") cobraria um dia a mais do colaborador.

⚠️ **Por isso o DSR NÃO é gravado na falta.** Depende do conjunto do mês:
gravado no lançamento, a segunda falta da semana guardaria zero e excluir a
primeira deixaria a semana sem repouso nenhum. O campo `desconto` continua
sendo **só o dia** (leitura legada); o DSR é sempre derivado.

⚠️ **Arredondar uma vez só, no total.** `2.269,40 ÷ 30 = 75,646666…` — arredondar
antes e multiplicar por 2 dá 151,30 em vez de 151,29. A linha do DSR recebe o
resíduo pra que as parcelas SEMPRE somem o total mostrado.

⚠️ `previaFalta` é **incremental**: o quanto o desconto do MÊS aumenta, não o
valor da falta isolada. Duas faltas iguais podem mostrar 151,29 e 151,30 —
parece centavo errado e não é; mostrar 151,29 nas duas faria a soma da tela dar
302,58 contra os 302,59 do holerite.

Tipos: `injustificada` (única que desconta) · `atestado` · `art473` · `abonada`.
Falta antiga, sem `tipo`, conta como injustificada — era como eram tratadas.
`MOTIVOS_473` traz inciso e limite de dias; inciso sem limite fixo devolve
`null`, não zero (zero impediria registrar).

Datas em **UTC** de propósito: o app guarda `AAAA-MM-DD` e o Amapá é UTC−3 —
ler como hora local jogaria a segunda para o domingo anterior e trocaria a
semana do DSR. Falta de vários dias **pula o domingo**: não se falta na folga, e
contá-lo descontaria o repouso duas vezes.

Decisões do dono (15/09/2026): repouso é **domingo** para todos (a loja fecha
domingo) · **feriado na semana não é descontado** (o entendimento majoritário diz
que também se perde, mas exigiria calendário de feriados) · **atraso não faz
perder o DSR**.

⚠️ Convenção coletiva pode ser mais benéfica que a lei. Isto é a regra legal; o
que o sindicato negociou é conferência da contabilidade.

**Vínculo conta ↔ funcionário:** `funcionarioId` + `mesRef` + `tipoRh`
(`folha`/`encargo`/`adiantamento`). Por id, nunca por nome — renomear o
funcionário não pode desfazer a ligação, mesma lição do código do Eclética. Em
Financeiro → + Novo, o campo **Fornecedor / Credor** sugere funcionários e
fornecedores já usados; é texto livre de propósito (fornecedor novo não pode
virar cadastro obrigatório).

**RH → Conferência**: o que o RH calculou contra o que está lançado, por mês.
Acusa lançamento duplicado (clicar duas vezes em "Lançar folha" criava duas
contas e a DRE somava as duas — agora tem trava), holerite fechado sem
lançamento, e conta de Salários sem funcionário.

⚠️ As contas criadas pela regra antiga (`origem` `falta_rh`/`consumacao_rh`)
**não são apagadas sozinhas** — apagar dado de mês fechado sem perguntar é pior
que mostrar o problema. Ficam listadas na Conferência com o total que inflam e
um botão de excluir.

⚠️ Conta de Salários **sem** funcionário continua somando na DRE e aparece à
parte, na Conferência e na linha da folha. As que já existiam não têm o vínculo,
e adivinhar de quem é cada uma seria chute.

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

### Cupom IA — erro da API

⚠️ **Sem crédito na conta da Anthropic volta como `invalid_request_error`** — o
mesmo tipo de "requisição malformada" de uma imagem ilegível. A tela mostrava a
mensagem crua em inglês junto com "tire a foto mais de perto", mandando
refotografar um cupom perfeito por um problema de fatura.

Duas marcações separadas de propósito no `/api/scan`:

| campo | para quê |
|---|---|
| `definitivo` | 400/401/403/404 e `invalid_request_error` — a tela PARA de tentar |
| `daConta` | crédito, chave, permissão — a tela ESCONDE as dicas de foto |

Imagem ilegível é `definitivo` mas **não** é `daConta`: ali a dica ajuda. Juntar
os dois num campo só reintroduz o bug por um lado ou pelo outro.

O front tentava 3 vezes mesmo o que nunca mudaria (o servidor já não retentava:
400 não está em `RETRY_CODES`), fazendo o usuário esperar o triplo pra ler a
mesma coisa.

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

### Paletas — Configurações → 🎨 Cores

Cinco paletas prontas (`PALETAS_APP`), cada uma com claro E escuro, gravadas em
`db.config.aparenciaApp.paleta` e aplicadas como `data-paleta` no `.app-root`.
O CSS redefine os MESMOS tokens; nenhuma tela precisa saber que existem.
Os **120 pares foram medidos** antes de entrar: nenhum abaixo de 4,5:1.

⚠️ **`personalizada` não define paleta nenhuma** — são os tokens base mais a cor
do seletor. O `--btnPrimary` inline só é aplicado nesse caso: **style inline
vence CSS**, e aplicá-lo sempre travaria o acento das cinco na cor antiga, sem
variante escura. Por isso o seletor de cor avisa que só vale ali.

⚠️ A prévia usa um `.app-root` **aninhado com `data-theme` próprio** — os tokens
moram na classe, então o filho herda o recorte e mostra o outro modo sem trocar
o app inteiro.

**O que estava errado (46 ocorrências):** a tag usava a cor **saturada** como
TEXTO sobre o tom claro da mesma família — `#22C55E` sobre `#DCFCE7` dá
**2,07:1**, menos da metade do legível. Os pares soft/ink (`--successBg` /
`--successText`) já existiam; as tags é que não os usavam — e por isso o modo
escuro também saía ilegível, já que hex fixo não troca com o tema. Depois da
correção o mesmo par dá **7,20:1**, na paleta antiga inclusive.

⚠️ **`config` entrou na fusão explícita do `mergeFromServer`** — era a armadilha
do §3 em pessoa. Escolher a paleta aplica local, funde com o servidor e posta:
como `config` vinha CRU do servidor, o merge devolvia o config de lá e a escolha
se perdia antes do POST. Vale também pra fonte, tamanho e cor de botão, que
tinham o mesmo problema. A fusão é união por chave em `aparenciaApp` e
`coresBotoes`, com o local vencendo; no `mergeDocument.js` os dois entraram na
lista de sub-objetos ao lado de `impressao` e `sortPrefs`.

⚠️ **Pendente:** ainda há cores fixas em JSX que podem virar token. As 555
dentro do HTML dos relatórios **não podem** (ver §8), e existem funções que
devolvem cor usadas nas duas pontas — substituição cega quebra a impressão.

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
