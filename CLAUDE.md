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
iaGemini.js           tradução Anthropic ↔ Gemini para o Cupom IA (com testes)
src/consumoTeorico.js consumo teórico de insumos a partir das vendas (com testes)
src/tipoInsumo.js     o que o item é e o que a venda faz com ele (com testes)
src/movimentoEstoque.js  entrada/saída/ajuste/produção manual (com testes)
src/folhaRh.js        folha: o que é desconto, o que é desembolso (com testes)
src/faltaClt.js       desconto de falta: o dia E o DSR, pela CLT (com testes)
src/nfeImportadas.js  quais NF-e já entraram, pela chave de 44 dígitos (com testes)
src/producaoDia.js    produção do dia: custo real, perda e baixa de insumo (com testes)
src/vinculoProducao.js  liga o nome da produção ao produto do Eclética (com testes)
src/autoSave.js       salvar, reagendar ou ignorar — a decisão que perdia dado (com testes)
src/paletas.test.js   mede o contraste das paletas LENDO o App.tsx (trava regressão)
src/vinculoSombra.test.js  trava o normalizarNome sombreado, LENDO o App.tsx
```

Stack: React + Vite + TypeScript. Backend em `http` puro, sem framework.
Persistência: **arquivos JSON por empresa** em `dados/confraria.json` e `dados/seama.json`.

Agentes que rodam fora do servidor:

```
ecletica-agent/    lê os XML de NFC-e do Eclética no PC do caixa (ver §4)
impressora-agent/  captura a comanda do 99Food e do iFood a caminho da impressora
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

### A armadilha nº 0: o auto-save que PULAVA e ESQUECIA

`src/autoSave.js` (com testes). Foi a causa do "os operadores inserem produtos
na lista e não atualiza pros outros", recorrente.

`setDbAndSave` liga `directSaveRef` por até **5 segundos** enquanto busca o
servidor, funde e posta. Dentro dessa janela, o efeito de auto-save fazia:

```js
if (directSaveRef.current) { prevState.current = state; return; }   // ERRADO
```

O `return` sozinho seria só atraso. O **`prevState = state`** é que marcava a
mudança como já processada: no ciclo seguinte a comparação não via diferença
nenhuma, `changed` vinha vazio e o POST **nunca acontecia**. Não era "pula e
salva depois" — era "pula e ESQUECE", sem erro, sem log.

Cada aparelho acumulava a própria pilha de mudança fantasma: visível na tela de
quem fez, ausente em todo o resto. Quanto mais rápido o operador trabalha, maior
a chance — daí ser recorrente justo na Lista de Compras, onde se adiciona um
item (`setDbAndSave`) e logo em seguida se reordena ou exclui outro (`setDb`).

⚠️ **A regra: enquanto o save direto roda, NÃO se toca em `prevState`.** A
diferença precisa continuar visível. E um tick reagenda o efeito quando ele
termina — sem isso a pendência esperaria o próximo toque do usuário.

⚠️ O comentário do `applyBothProdutos` já descrevia esse mecanismo ("chance real
de nunca chegar no servidor, silenciosamente") e a função se defendia salvando
por conta própria. A defesa dela continua válida; agora o buraco embaixo está
tapado.

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

### A armadilha do CARIMBO que falta (`produtosLista`)

`mergeArrayById(servidor, local)` desempata por `updatedAt`/`atualizadoEm`. Quando **só
o servidor** tem carimbo, **o servidor vence** — a edição local é revertida pelo poll.

Foi essa a causa de *"mudo a rua/categoria do produto no celular e ele volta pra sem
rua"*: a tela gravava o produto **sem** `atualizadoEm`, e o registro do servidor (que
tinha carimbo de uma gravação anterior) ganhava a disputa. Não é conflito entre dois
operadores — basta **um**: a versão antiga dele mesmo, no servidor, é quem revertia.

⚠️ **Toda escrita em `produtosLista` carimba `atualizadoEm`** — criação inclusive, senão
o primeiro save da vida do produto já nasce perdendo. `src/carimbos.test.js` lê o
`App.tsx` e reprova quem esquecer.

⚠️ **E toda escrita usa `applyBothProdutos`**, nunca `setState` cru: `produtosLista` é
compartilhado entre as duas empresas (§1) e `applyBothProdutos` é quem salva por conta
própria. Cinco telas de rua gravavam com `setState` puro — mudança local que dependia do
auto-save genérico e caía na armadilha nº 0.

---

## 4. Estrutura do `db` (por empresa)

```
vendas              lançamentos diários por canal (ver §6)
fechamentos         checklist do fechamento por dia {data:{marcados:{item:{por,em}|null},obs}} — mapa em 2 níveis
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

### Ponte de impressão 99Food e iFood (`impressora-agent/`)

Nenhum dos dois abre API pra loja ler o próprio pedido; o que existe é a comanda
que já sai impressa na cozinha. O agente fica **entre** o app e a impressora
(TCP 9100), guarda o trabalho e **repassa os mesmos bytes** pra impressora real.

**Os dois aplicativos são capturados ao mesmo tempo, na mesma janela**, cada um
na própria impressora de captura, gravando na própria pasta
(`CAPTURA_PASTA_99` / `CAPTURA_PASTA_IFOOD`; ou `CAPTURA_PORTA_*` pra quem só
aceita IP — os dois jeitos convivem).

⚠️ **Uma pasta só para os dois seria mais fácil e é o que não serve:** a Local
Port do Windows grava SEMPRE no mesmo nome, então dois pedidos quase juntos se
sobrescrevem e a cozinha perde uma comanda. Pastas separadas viram duas filas.

⚠️ **O rótulo da pasta é só a suspeita; quem manda é o TEXTO da comanda**
(`plataforma.js`, com testes). Pasta trocada na instalação é erro silencioso, e
seguir o rótulo jogaria o pedido no canal errado de Vendas — taxa diferente,
faturamento errado, nada denunciando. A divergência vira aviso na tela.
A separação funciona porque **"99food" não contém "ifood"**.

⚠️ A origem entra no **NOME do arquivo** (`..._99food.bin`), não só no log:
quem procura a comanda de um pedido semanas depois procura na pasta.

⚠️ **O leitor é POR PLATAFORMA, e a CONTA de cada um é diferente.** Rodar o do
99Food numa comanda do iFood não daria erro: daria um pedido pela metade, com
número e itens plausíveis e os dois dinheiros vazios.

```
99Food   pagoPeloApp + cobrarDoCliente = total
iFood    total + taxaServico + taxaEntrega − descontos = pagoPeloApp + cobrarDoCliente
         29,90 +       0,99 +        7,00 −     15,00 =      22,89 +            0,00
```

No iFood o **total é só a mercadoria** e as taxas entram por fora. Usar a
fórmula do 99Food ali acusaria divergência em todo pedido — e o aviso que grita
sempre é o aviso que ninguém lê. Por isso cada leitor tem a própria
`conferir…`, e `plataforma.js` escolhe o par pela origem.

Os dois nasceram de comanda **real**: `pedido99.js` da #871001,
`pedidoIfood.js` de um pedido de teste capturado no caixa em 15/09/2026.
**Não escreva parser de layout imaginado.**

#### O que a comanda do iFood ensinou (`pedidoIfood.js`, com testes)

⚠️ **O repasse vem NEGATIVO** (`Pagamento via iFood: -R$ 44,87`) porque para a
comanda é abatimento. É guardado **positivo**, como no 99Food: o campo quer
dizer "o que a plataforma repassa" nos dois. Guardar o sinal cru obrigaria quem
lê a saber de qual plataforma veio antes de somar — é assim que um dia alguém
subtrai faturamento sem perceber.

⚠️ **`"pedido:"` aparece DUAS vezes**: no cabeçalho (`PEDIDO: #1234`) e como
rabo de `Valor total do pedido:`, que a térmica quebra em duas linhas.
Atribuindo direto, a segunda apagava o número lido na primeira e a conferência
acusava "sem número" num pedido que tinha número impresso.

⚠️ **O menos tem que estar COLADO no `R$`.** Com `-?\s*` no meio,
`1x PEDIDO DE TESTE -    R$ 6,99` — onde o hífen é sobra do nome cortado em 32
colunas — virava menos 6,99, e os itens somavam negativo.

⚠️ **A INDENTAÇÃO separa item de complemento** (`1x Item` vs `    1 Chilli`),
e há dois níveis (o ketchup dentro do sanduíche). Sem ela, cada complemento
viraria um item e o ranking de produtos passaria a vender "Chilli". Por isso as
linhas são aparadas só à direita.

⚠️ **O rodapé encerra a leitura** (`break`, não `continue`): a versão quebra em
duas linhas (`Gestor Web 9.342.0 - Desktop` / `8.10.0`) e a sobra virava
pendência em todo pedido.

⚠️ Valor não lido aparece como **`?` na tela, nunca `R$ 0,00`** — zero diria
que o pedido não tinha aquele dinheiro.

**O primeiro pedido REAL (entrega parceira) trouxe mais três**, que a comanda
de teste não tinha — daí a regra de escrever leitor só em cima de comanda real:

⚠️ **O rótulo inteiro pode quebrar**, não só o valor: saiu `CODIGO DE COLETA`
numa linha e `PARCEIRA: 5977` na de baixo. Lendo só a primeira, o código virava
a string "CODIGO DE COLETA" e o número caía em `naoEntendido` — o entregador
chegaria e ninguém teria o código pra conferir.

⚠️ **`Ref:`** (ponto de referência) existe e não aparecia na comanda de teste.

⚠️ **`Primeiro pedido!` e `N pedidos na sua loja` são recado do app pro
lojista**, não dado do pedido: sem suprimir, viram pendência em toda comanda.

⚠️ Complemento de graça (`1 Coca-Cola Lata R$ 0,00`, a bebida do combo) é lido
como ZERO, não como "sem valor" — senão a conferência acusaria item sem valor
em todo combo.

**O terceiro pedido real trouxe o DESCONTO**, e ele muda a fórmula:

⚠️ **`Descontos : -R$ 15,00` entra na conta.** Num pedido real de R$ 29,90 com
R$ 15,00 de promoção, ignorá-lo acusaria divergência de exatamente esses
R$ 15,00 — em toda comanda com promoção, que no iFood são muitas, até ninguém
mais olhar os avisos. Guardado **positivo**, como o repasse: o sinal fica na
fórmula, não no dado.

⚠️ **ITEM e COMPLEMENTO são testados ANTES de qualquer rótulo** dentro do bloco
de itens — a mesma lição que o `pedido99.js` já tinha e que faltava aqui. Com o
rótulo ganhando, `1x Desconto especial R$ 5,00` viraria a linha de Descontos do
pedido: o item sumiria do ranking **e** o abatimento entraria em dobro. Só a
CONTINUAÇÃO de nome respeita rótulo, senão `* Pagamento realizado *`, que vem
indentado dentro do bloco, seria colado no nome do último item.

⚠️ **`Ref:` quebra em QUANTAS linhas precisar** ("ao lado de um galpao de uma /
oficina, e uma casa de altos e / baixos") — lendo só a primeira, o resto virava
pendência.

**Os nove primeiros pedidos reais (R$ 325,31) deixaram UMA pendência só**, e ela
valia por três: **todo texto quebra em 32 colunas**, não só o endereço.

⚠️ **O NOME DA LOJA quebra** ("Confraria Cafe e / Empreendimentos") — virava
pendência em TODO pedido daquela loja. Junta enquanto não for rótulo nem
**carimbo da via** (`ehCarimboDaVia`: EXPEDICAO, PREPARO PRIORITARIO, TURBO,
Primeiro pedido!, N pedidos na sua loja, Entrega Propria/Parceira, a linha do
telefone com ID). Sem parar neles, a loja engoliria "EXPEDICAO".

⚠️ **`Comp:` e `Bairro:` também quebram** — liam uma linha só, e a sobra ("Bloco
B", o resto do nome do condomínio) virava pendência.

⚠️ A configuração antiga (`CAPTURA_MODO` + `CAPTURA_PASTA`/`CAPTURA_PORTA`, uma
fonte sem rótulo) continua valendo: quem já instalou não é obrigado a
reconfigurar. Sem rótulo, a origem sai do texto.

#### Lições da instalação real (15/09/2026, PC do caixa)

A comanda sai na **ELGIN i8** (USB001). As duas EPSON da loja são de REDE
(COZINHA 192.168.100.180, BALCAO 192.168.100.88) e ficam como alternativa.

⚠️ **Nome de impressora com ESPAÇO é o normal**, não a exceção. O `copy /b` ia
sem aspas: o cmd leria `ELGIN` como destino e `i8` como um segundo arquivo de
origem. O comando vai inteiro num argumento, **começando por `copy`** — com
`cmd /c`, linha que começa com aspas cai na regra de remoção de aspas do cmd.

⚠️ **O nome do compartilhamento é conferido na SUBIDA** (`conferirNomeCompartilhado`,
com testes). O config ficou com o nome de EXEMPLO (`TERMICA`); o agente subiu
anunciando "repassando para `\\localhost\TERMICA`" e só falhou quando a
comanda chegou — o pior momento possível. Difere só por caixa/espaço? Sugere o
nome certo. **Avisa, nunca impede de subir:** a captura não depende do repasse.

⚠️ **`capturas/exemplo.bin` nunca existiu** — `capturas/` está no `.gitignore`,
então numa instalação nova a pasta nem é criada, e o README mandava testar com
ele. O teste do repasse é o **`papel.bat`**: manda a comanda de teste direto pra
impressora, sem captura, sem agente rodando, sem arquivo de exemplo.

⚠️ **PowerShell exige `.\` para rodar um `.bat` da pasta atual**, e `node
agent.js` chamado na mão **não carrega o `config.bat`** — foi assim que a
instalação travou duas vezes seguidas. Os `.bat` são feitos para dois cliques.

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

**A comanda real da Confraria (#871010, 15/09/2026) trouxe duas linhas novas** —
e ela chega como IMAGEM, então foi lida do `.png` capturado, não de um `.txt`:

```
Subtotal                           39,90
Taxa de entrega                    +3,99
Entrega promocional para cliente   −3,99   ← frete grátis
Taxa de serviço                    +2,40
Total do pedido                     42,30
Pagamento via 99Food 42,30 + Cobrar do cliente 0,00 = 42,30
```

⚠️ **`conferirPedido99` ganhou a SEGUNDA conta:** `subtotal + taxas −
abatimentos = total`. A primeira (repasse + cobrança = total) continuava
fechando mesmo com a taxa de serviço ignorada — o total é que estaria errado. O
iFood inventou três linhas novas em três comandas; sem a segunda conta, a
quarta entraria calada.

⚠️ **Abatimento é guardado POSITIVO** (`entregaPromocional`, `desconto`), como
no iFood: o campo diz "quanto foi abatido" e o sinal fica na fórmula. Guardando
cru, a conferência SOMARIA o abatimento e o erro apareceria como um total
errado por duas vezes o desconto. **Mudou em 17/09** — `desconto` era cru.

⚠️ **Frete grátis ANULA a taxa de entrega na despesa do canal**
(`lancamentoVendas.js`): o 99Food cobrou 3,99 e devolveu os mesmos 3,99, então
o cliente não pagou frete. Contar os 3,99 como despesa inventaria uma despesa
que não existiu e o líquido do canal sairia menor que a venda. Com a promoção,
`liquido` bate exatamente com o `subtotal`.

#### A comanda do 99Food chega DESENHADA — a IA transcreve, o leitor é o mesmo

116–123 KB de raster e `.txt` vazio. Testado na loja em 16–17/09: o driver
**Generic / Text Only não resolve** (o app manda bitmap pronto) e o `.txt` não
tem nada aproveitável. Nenhum driver extrai texto de onde não tem.

`POST /api/comanda-ocr` (autenticado pelo `SEAMA_SERVICE_SECRET`, como o
`/api/venda-pdv`) recebe o PNG e devolve o **texto**.

⚠️ **A IA TRANSCREVE; quem LÊ é o `pedido99.js` e quem DECIDE é a aritmética
dele.** A diferença não é estilo, é onde o erro aparece:

| | |
|---|---|
| pedindo **JSON** | a IA faz a conta. Um total alucinado sai coerente com os itens que ela mesma inventou, passa em qualquer conferência e vira faturamento errado, calado |
| pedindo **TEXTO** | a IA faz só OCR, que é o que ela sabe. Um dígito trocado quebra `subtotal + taxas − abatimentos = total` e o pedido **não entra no dia** |

⚠️ O prompt é todo feito pra **impedir a IA de ajudar**: não somar, não
converter, não completar palavra cortada, não corrigir erro da comanda,
ilegível vira `???`. Cada uma dessas gentilezas destruiria a conferência, porque
a aritmética passaria a bater com o que ela inventou em vez de com o papel.

⚠️ **A transcrição é gravada em `.ocr.txt` e REUSADA.** Sem o cache, cada
`reprocessar.bat` gastaria uma chamada por comanda antiga — e reprocessar existe
justamente pra ser rodado à vontade quando o leitor melhora.

⚠️ **`lidoPor` no `.json`** diz `escpos` ou `ia`: quem conferir um número meses
depois precisa saber se o texto veio da impressora ou de uma transcrição.

⚠️ `interpretar` é chamado **também quando não sobrou linha de texto** — antes
só rodava quando havia texto, e a comanda em imagem morria ali sem nem tentar.
E o `--reprocessar` **espera** (`await`) cada leitura: sem isso os envios do fim
rodariam antes das transcrições e mandariam o dia pela metade, que o endpoint
substituiria em vez de somar.

⚠️ Falha na transcrição **não para nada**: o papel já saiu, o `.bin`/`.png`
estão guardados e o `reprocessar.bat` tenta de novo.

⚠️ **Decisão do dono (17/09/2026): pelo Gemini**, mesma faixa gratuita do Cupom
IA. Diferente do cupom, aqui vai **dado de cliente** (nome, endereço, telefone)
— e na faixa gratuita o Google pode usar o conteúdo enviado (ver §8). Escolha
consciente; `IA_PROVIDER=anthropic` inverte, ao custo de crédito lá.

**O primeiro lote transcrito (54 capturas) expôs UM defeito, em quase todas:**

⚠️ **O NOME DO ITEM QUEBRA, e o valor pode cair na quebra junto.**
`1x Coxinha de Frango com / Catupiry / R$12,00` chegava como um item com nome
pela metade e DUAS pendências — e o item ficava **sem valor**, então
"itens somam 19,90 e o subtotal diz 31,90" saía em todo pedido e a conferência
virava ruído. O `pedidoIfood.js` já sabia juntar continuação; o `pedido99.js`
nunca precisou, porque a #871001 não quebrava.

A versão anterior olhava **uma** linha à frente atrás do valor. Não bastava:
entre o item e o valor tinha o resto do nome. Agora absorve **até** rótulo
conhecido ou item novo — e linha que é SÓ valor vira o valor, linha com texto
continua o nome.

⚠️ **A continuação PARA no bloco de totais.** Sem isso o "Subtotal" viraria
parte do nome do último item e o pedido inteiro se desmontaria.

⚠️ **Mudou o significado de "linha solta depois de item".** Antes era pendência;
agora é continuação de nome, porque é o que ela é em quase toda comanda real. A
pendência continua valendo FORA do bloco de itens, que é onde uma linha nova de
verdade apareceria.

⚠️ **A hora do aceite quebra** (`Horário de aceite do pedido:15 de set` /
`16:00`) — é a ÚLTIMA linha da comanda, então o ruído dela fechava a lista de
pendências.

#### O pedido vira faturamento — `lancamentoVendas.js` (com testes)

Mora fora do agente porque é a única parte disto que erra em **silêncio**:
leitor errado aparece na tela, conta errada vira um número plausível no
faturamento do mês.

**Decisões do dono (15/09/2026)**, sobre o pedido real de R$ 29,90 com R$ 15,00
de promoção e entrega da parceira:

| coluna | valor | o quê |
|---|---|---|
| `ifood` | 22,89 | o que o cliente PAGOU pelo app — não a mercadoria de tabela |
| `ifoodTaxa` | 7,99 | entrega da parceira (7,00) + taxa de serviço (0,99) |
| `ifoodLiq` | 14,90 | o que a loja vendeu |
| `dinheiro` | 0,00 | o que o entregador cobra na porta, dos dois canais |

⚠️ **O desconto NÃO vira despesa.** Como o faturamento é o que o cliente pagou,
ele já está lá dentro (pagou 22,89 em vez de 37,89). Lançá-lo também como
despesa contaria o mesmo real duas vezes — regra do `folhaRh.js`. Fica em
`descontos`, como INFORMAÇÃO, fora de toda soma.

⚠️ **A taxa de entrega só é despesa quando quem entrega é a PLATAFORMA.** Em
"Entrega Propria" ela fica com a loja. Sem saber quem entregou, fica de fora e
sai aviso — chutar tiraria do faturamento um dinheiro que entrou na gaveta.

⚠️ **`ifoodLiq` é ANTES da comissão**, que não está na comanda (só no extrato).
Chamar de "o que vou receber" seria mentira.

⚠️ **A mesma comanda é impressa DUAS vezes** (cozinha e sacola) e as duas são
capturadas — vimos com 1 segundo de diferença. `lancamentoDoDia` descarta
repetição por canal + número; sem isso o dia DOBRA em silêncio. Pedido sem
número entra e é sinalizado, nunca descartado.

⚠️ **O dia é reconstruído dos `.json` da pasta**, não acumulado na memória:
`/api/venda-pdv` SUBSTITUI o registro do dia, então um reinício do PC zeraria o
acumulador e o envio seguinte trocaria o dia inteiro pelos poucos pedidos que
chegaram depois. Reenvia a cada pedido, na subida e a cada 10 min, com ONTEM
junto.

⚠️ `hojeISO` usa data **LOCAL**, não `toISOString()`: o Amapá é UTC−3 e às 21h
o UTC já é o dia seguinte — o pedido subiria no dia errado.

⚠️ O endpoint gravava `ifood: 0, ifoodTaxa: 0, …` **fixo**. Agora aceita os
campos; quem não manda (delivery-backend, PDV Seama, ecletica-agent) continua
com zero, sem mudar nada.

⚠️ **Nem tudo que passa pela impressora de captura é pedido.** A comanda do
`teste.bat`, uma página de teste do Windows, um documento mandado por engano —
todos chegam ao leitor. A porta é `ehComanda99`/`ehComandaIfood`, conferindo o
CONTEÚDO depois que a origem escolheu quem lê. Ela ficou aberta quando o leitor
passou a ser escolhido pela origem (antes `ehComanda99` era o próprio gatilho),
e na loja isso virou **cinco comandas de teste como cinco pedidos de R$ 0,00**.

⚠️ **Pedido sem NENHUM valor de pagamento fica FORA do dia**, com aviso. A
primeira versão dizia "não entra no dia" e entrava assim mesmo, como zero —
aviso que contradiz o número que sobe ensina a não ler os avisos.

⚠️ **`reprocessar.bat` (`--reprocessar`) relê todos os `.bin` com o leitor de
hoje**, refaz os `.json` e reenvia os dias. Pedido capturado antes de o leitor
daquela plataforma existir ficou só como bytes — real, no disco, fora do
faturamento. É pra isso que o `.bin` cru é guardado. **Não imprime nada:**
reprocessar não pode fazer sair papel de pedido antigo na cozinha.

**Estado:** captura, lê e **envia** — origem `pdv_comandas`, uma só para os dois
aplicativos (o Gestão não tem coluna de "dinheiro na porta" por plataforma).
Sem `SEAMA_SERVICE_SECRET` no `config.bat`, captura e lê normalmente e não
envia.

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

#### Vendas → Lançamentos: a tela é um fechamento, não um formulário

Total do dia em cima (soma de TODAS as origens do dia + o que está sendo
digitado), com "ontem" e delta ao lado — o delta é o que denuncia 30,55 digitado
no lugar de 3.055. Abaixo, dois blocos com papéis opostos:

| bloco | o que mostra | pode digitar? |
|---|---|---|
| **Apurado automaticamente** | uma linha por forma de pagamento quando a origem manda `formas` (PDV Eclética), senão por canal (PDV Seama); delivery sincronizado com "editar"; pendura em separado | não |
| **Falta informar** | só os canais SEM valor automático no dia + iFood/99Food (bruto · taxa% · líquido calculado na linha, taxa vem do último lançamento) | sim |

⚠️ Maquininha e dinheiro só aparecem como campo quando o PDV **não** apurou o
canal naquele dia. Quando apurou, ficam recolhidos em **"+ Maquininha fora do
PDV ou dinheiro extra"** — o campo continua existindo (as linhas somam no
Dashboard, é a regra de sempre), só não fica ao lado do valor automático
convidando a digitar de novo. Foi assim que o aviso "não repita aqui, os dois
somam" deixou de ser necessário: o layout parou de induzir o erro em vez de
avisar sobre ele. A seção abre sozinha se já houver valor digitado nela —
esconder um número que soma é pior que o aviso antigo.

**Checklist do fechamento** (opcional, recolhido no fim do card): itens vêm de
`aj.checklistItens` (Vendas → Ajustes, um por linha); estado por dia em
`db.fechamentos[data]` — `marcados[i]` é `undefined` (nunca tocado: vale o
automático), `null` (desmarcado à mão) ou `{por,em}`. Automático por palavra no
texto do item ("PDV" → alguma origem automática apurou o dia; "salvo" →
lançamento manual do dia existe), porque chavear por índice quebraria ao
reordenar as linhas em Ajustes. Fusão em 2 níveis nos dois lugares
(`mergeFromServer` e `mergeDocument.js`, com teste). **Imprimir checklist
(A4)** → `gerarFechamentoCaixaHTML`: timbre de Configurações → Impressão,
valores do dia, caixas em branco (a marcação é à caneta), conferência física do
caixa, assinaturas — preto e branco de propósito.

#### Editar recibo emitido: quem já foi lançado precisa REFAZER a soma em Vendas

O painel de edição tem dois caminhos de gravação, e a diferença é a origem do
bug: `onSalvar` grava **só o recibo**; `onSalvarComVendas` grava o recibo **e**
refaz Vendas (subtrai do dia antigo, soma no dia alvo, `consolidarVendasDoDia`
nos dois dias antes de mexer).

⚠️ **Editar Data e Editar Valores chamavam `onSalvar`.** O recibo passava a
dizer 15/09 e os R$ 462,00 continuavam somados em 16/09, sem aviso nenhum — o
dia fechava errado dos dois lados e nada na tela denunciava. `salvarComVendas`
já sabia mover de dia (`dataAlvo=atualizacoesRecibo.data||antigo.data`, escrito
para o editor de itens); faltava ser chamado. Corrigido em 16/09/2026.

⚠️ **Só quem tem `lancadoEmVendas && valorLancado>0` passa por lá**
(`jaLancado`). Recibo nunca lançado continua em `onSalvar`: mexer em Vendas ali
lançaria um recibo que o dono deliberadamente não lançou — e o botão
"{legVendasExtras}" existe justamente para essa decisão ser explícita.

As duas telas mostram antes de salvar o que vai acontecer no dia ("sai de
16/09 e entra em 15/09", "o dia 15/09 passa de R$ 462,00 para R$ 400,00").

**Histórico** é um extrato: colunas fixas por canal em todo dia (Dinheiro ·
Maquininha · Vendas Extras · iFood líquido · 99Food líquido · Total), uma linha
por origem, detalhe das formas em texto pequeno embaixo, sem etiqueta colorida.
Lançamento manual com total 0 aparece apagado como "sem valores" — é o registro
que o Salvar cria num dia só de PDV; a lixeira ali é de propósito.

Números em fonte mono tabular (`MONO`), rótulos na fonte do app
(`var(--fonteApp)`, definida no `.app-root`) mesmo com a aba Vendas em fonte
"Técnica". Verde = conferido, âmbar = pendente; nada mais é verde.

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
Inventário · Contagem · Análise · Movimentações · Projeção de compras · Saldo
Estoque · Produção do Dia · **Fichas técnicas** (só leitura) · Manutenção ·
Produtos Eclética · Saídas por venda.

**Fichas técnicas em Estoque** (`FichasEstoquePanel` + `FichaTecnicaCard`) é a
MESMA ficha de Produção → Fichas, vista pelo estoque: rendimento, insumos com o
saldo de hoje convertido pra unidade da ficha e "dá para produzir N receitas —
limita: X". **Não edita**; o link "editar em Produção → Fichas" navega
(`setPendingSub("ficha")` + `onNavigate("producao")`). Um segundo cadastro
seria a quarta lista de produtos do sistema.

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

### Estoque → Produção do Dia — `src/producaoDia.js` (com testes)

A baixa de insumo por produção **já existia** na Manutenção de Produtos. O que
faltava era o resto.

#### Vincular produção → produto do Eclética — `src/vinculoProducao.js` (com testes)

A cozinha pede **"Coxinha de frango"**; na prateleira o item é **"SALG COXINHA
FRANGO"**. Sem ligar os dois, produzir não alimenta saldo nenhum e o pedido não
fecha — era o que deixava 54 itens pendentes com "sem produto no estoque".

⚠️ **Isto NÃO é a aba "Vínculos" que foi apagada** (ver "Estoque → Saídas por
venda"). Aquela mapeava produto VENDIDO → ficha, e virou automática quando os
produtos ganharam `codigoEcletica` — o XML da venda traz o mesmo código. Aqui o
lado de origem é o NOME digitado no catálogo de produção, que não tem código
nenhum e nunca casa sozinho.

Ferramenta em **Produção → Produtos → 🔗 Vincular ao estoque**
(`VincularProducaoCard`): lista o que está sem vínculo ordenado pelo que mais
aparece nos pedidos, sugere o par por semelhança de nome, e tem o botão de
aplicar as sugestões SEGURAS em lote. Decisão do dono (16/09/2026): a conversão
é **1 para 1** — quanto uma receita rende continua sendo o Rendimento da ficha,
um lugar só para essa conta.

| onde mora | o quê |
|---|---|
| `produtosProducao[].mpId` | o vínculo. Campo no cadastro que já existe — **não** é campo novo no `db`, então não entra na armadilha do §3 |
| `itemDeEstoqueDaProducao` | resolve: vínculo → nome igual → nada. **Nunca chuta por semelhança** — palpite é sugestão de tela, jamais baixa de saldo |
| `apelidosDoItem` | os nomes de produção de um item, para o fechamento do pedido |

⚠️ **`seguro` é deliberadamente duro** (score ≥ 0,85 E o segundo colocado pelo
menos 0,15 atrás): "Trança de calabresa" e "Trança de camarão" pontuam alto
contra "TRANCA CALABRESA", e sem a margem o lote ligaria o camarão na calabresa
sem ninguém ver.

⚠️ **O apelido é TRADUÇÃO, não segunda chave de saldo.** `baixarPedidos` recebe
`apelidos` {nome do pedido → nome produzido}: somar o produzido nos dois nomes
daria um orçamento a cada um, e dois itens de pedido com esses nomes fechariam
os dois com a mesma fornada.

##### A busca só oferece quem pode receber produção

⚠️ **A busca mostrava a DESPENSA no lugar do cardápio.** Procurar "Torta
Banoffee" respondia "bandeja retangular de isopor", "banana nanica", "bandana
preta". Duas causas somadas, as duas silenciosas:

**1. O balaio errado.** `materiasPrimas` é "item com saldo", não o cardápio: os
281 produtos do Eclética moram na mesma coleção que a farinha e o detergente. A
busca — e a SUGESTÃO automática, que vincula em LOTE — liam a coleção inteira.
Ligado a um insumo comprado, a fornada entraria no saldo do que se compra: o
insumo pareceria nunca acabar, a compra seguinte viria menor, e só a contagem
física denunciaria. `candidatosDeVinculo` recorta os dois grupos legítimos —
produto com `codigoEcletica` (o código vale mesmo sem marcação de tipo, porque
importar sem marcar é o normal) e item marcado `produzido` (os recheios, que não
têm código). `produzido` nunca vem de palpite por categoria, então o insumo
comprado não entra por acidente. O que casa e fica de fora continua alcançável,
atrás do aviso do que acontece se ligar — sumir de vez deixaria um item legítimo
mal cadastrado sem como ser ligado.

**2. ⚠️ O `normalizarNome` SOMBREADO — e este é o que realmente escondia o
cardápio.** O `App.tsx` declara um `normalizarNome` próprio (o da conciliação de
importação, `(nome, norms)`, §6 Compras) e ele vence o import do
`vinculoProducao.js`. Chamado com **um argumento só**, aquele cai no
`if(!nome||!norms?.length) return nome` e devolve o nome **intacto** — sem
minúscula, sem tirar acento. O cardápio é cadastrado em CAIXA ALTA ("SALG
COXINHA FRANGO"), então `"TORTA BANOFFEE FATIA".includes("ban")` dava **falso** e
só os insumos comprados, digitados em minúscula, respondiam. Por isso o import
entra **apelidado** (`normalizarNome as normProducao`), e
`src/vinculoSombra.test.js` lê o `App.tsx` e reprova quem chamar o nome cru
dentro do card. Nem o build nem o TypeScript acusam: é chamada válida, com
argumento opcional faltando.

⚠️ O sombreamento atingia **dez** chamadas do card, não só a busca: `l.chave`
nascia crua, e o "criar produto" que deveria **reaproveitar** o item existente
não o encontrava quando a caixa diferia — criaria um item duplicado, calado.

##### Vincular como RECHEIO

O frango cremoso do croissant é feito na cozinha, entra no estoque e **não é
vendido**: sai como insumo da ficha de outro produto. O botão **"é recheio"** na
ferramenta cria/liga o item e marca esse papel.

⚠️ **Recheio é PAPEL, não um sexto tipo de item.** O item continua `produzido`
(ver "Item com saldo: cinco tipos, uma coleção") — é feito e tem saldo próprio.
Criar um tipo novo obrigaria `baixaDaVenda`, contagem, Saldo Estoque e
movimentações a aprender uma regra que é exatamente a do produzido.

⚠️ **A marcação mora em `produtosProducao[].recheio`**, no cadastro que já
existe — não é campo novo no `db`, não entra na armadilha do §3.

⚠️ **Marcar no catálogo era o que faltava.** `ehRecheio` reconhecia recheio só
pelas fichas que usam o item como insumo (`fichasQueUsam`), então um recheio
recém-criado ficava **sem identidade** até alguém escrever a ficha que o
consome: não subia ao topo da folha da Produção do Dia e não avisava nada. Agora
a ordem é: marcação do catálogo (a declaração do dono, vale antes de existir
ficha) → fichas que o usam. A linha sem ficha nenhuma avisa "nenhuma ficha usa
ainda — vai entrar no estoque e ficar parado", em vez de ficar calada.

⚠️ **Ligar a um item que já existe NÃO troca o tipo dele.** "Criar produto"
reaproveita a matéria-prima de mesmo nome em vez de duplicar, e se o tipo dela
não for produção própria o alerta diz isso e manda ajustar em Saldo Estoque —
trocar calado mudaria a baixa por venda de um item comprado.

#### A ponte pedido → produção (16/09/2026)

⚠️ **O pedido da cozinha NUNCA fechava.** `baixarPedidos` procurava o produzido
por `produtoId || id || nome`, mas **nenhum pedido real carrega `produtoId`**:
o catálogo do Novo Pedido gravava só `nome` e o caminho manual um `id` próprio
do item, enquanto a Produção do Dia manda tudo chaveado pelo **id da
matéria-prima**. As chaves nunca batiam, então todo pedido ficava "aberto" para
sempre e a lista só crescia (18 itens acumulados quando isto foi descoberto).
Os testes não pegaram porque todos usavam `produtoId`, que só existe em dado
inventado.

A ponte tem os dois lados:

| onde | o quê |
|---|---|
| `baixarPedidos` | casa também pelo **nome normalizado**, e o produzido virou um **orçamento consumido em cascata** — a mesma unidade não fecha dois itens |
| Novo Pedido | pedidos **novos** gravam `produtoId` = id da **matéria-prima** (não do catálogo de produção) quando o produto já existe; pedido antigo continua fechando pelo nome |
| Produção do Dia | o pedido do dia **carrega sozinho** na folha, com a quantidade pedida já no campo |

⚠️ **Cascata não é detalhe:** o catálogo cria um item por produto+categoria, então
o mesmo nome aparece duas vezes no MESMO pedido de propósito (SEAMA pede 10,
BARTOLOMEIA pede 5). Dar o total cheio aos dois fecharia 15 tendo produzido 10.
Item já atendido não consome orçamento, e produzir a mais não fecha mais do que
foi pedido.

**A folha vira a conferência do pedido**: cada linha mostra "pedido N un" e um
selo — **bateu o pedido** / **faltou N** / **N a mais** / **não produzido**. A
caixinha desmarcada é "não produzi isto hoje": fica fora do registro e continua
pendente, que é diferente de zero digitado. Editável por linha: quantidade,
receita/unidade, perda e remover. **O nome não é editável** — é ele que liga o
item ao produto do estoque e ao pedido.

⚠️ **Carrega SÓ o pedido cuja data é a da folha** (decisão do dono). O que sobrou
de dias anteriores fica atrás do link "ver e trazer para a folha" — some da
frente sem sumir do sistema.

⚠️ **Duas armadilhas de timing**, as duas já corrigidas e as duas invisíveis no
build: (1) a decisão de "já está na folha?" mora DENTRO do `setLinhas`
funcional, não no fechamento do efeito; (2) registrar limpa a folha **depois**
que o efeito rodou (o save usa `flushSync`), então existe um contador
`recarga` que é o pedido explícito de trazer de volta o que ficou parcial. Sem
ele, produzir 12 de 24 deixava a folha vazia e os 12 restantes só voltavam com
F5. Criar produto para um item do pedido também bumpa `recarga`.

⚠️ Item do pedido **sem produto no estoque** (ex.: "Biscoito p/ café") aparece
em âmbar com botão **criar produto** (cria com saldo zero e já marcado como
`produzido`). Não entra no saldo nem baixa insumo enquanto não existir — mas
**não bloqueia** o registro, e o pedido fecha do mesmo jeito.

**A tela é uma folha em branco** (decisão do dono, 15/09/2026) quando não há
pedido do dia: só entra o que a cozinha fez, pela busca. Abria com 18 pedidos +
12 "outros" e a pessoa rolava por produto que não produziu. Os 195 chips de
"saldo zerado ou negativo" viraram um link. `Linha` virou função (`linhaJsx`), não componente
inline: componente recriado a cada render desmontava o input a cada tecla.

**Receitas × unidades**: produto cuja ficha tem `porcoes > 1` lança em
receitas por padrão ("2 receitas → 24 fatias"); a conversão é só na tela —
`calcularProducaoDia` continua recebendo unidades. Perda é sempre em unidades.
Pedido da cozinha pré-preenche em unidades (o pedido é em unidades).

**Recheio** = item produzido que não é vendido: sai como insumo da ficha de
outro produto. Reconhecido pela marcação do catálogo (`produtosProducao[].recheio`,
posta em Produção → Produtos → Vincular ao estoque) OU pelas fichas que o usam
(`ehRecheio`/`fichasQueUsam`, em `src/vinculoProducao.js`). Sobe para o topo da
folha e mostra "usado hoje por … · sobra N". ⚠️ Na prévia, a SAÍDA de um insumo que também foi
produzido hoje parte do saldo **com** a entrada do dia (`saidaExibida`): a
aplicação real faz entrada antes da saída, e sem isso a tela mostrava "4 → −16"
para um saldo que termina em 4.

⚠️ **`baixarPedidos` CARIMBA `atualizadoEm`** no pedido que alterou. Sem o
carimbo o fechamento não sobrevive à fusão: o merge do servidor desempata por
timestamp e, com a cópia do arquivo trazendo um carimbo mais novo (qualquer
gravação anterior daquele pedido), a versão ABERTA vencia e o fechamento era
descartado — **o estoque entrava e o pedido continuava pendente**, a tela
mostrando fechado (estado local) e o arquivo, aberto. É a "armadilha do CARIMBO
que falta" do §3; custou um dia de investigação em 16/09/2026 e passou nos
testes iniciais só porque ali os carimbos empatavam (no empate o incoming vence).

**Repetir produção de <dia>** lê `movEstoque` de `origem:"producao_dia"`
(entrada = boas, perda à parte → produzido = soma); volta em receitas quando o
produzido é múltiplo do rendimento; perdas não se repetem.

⚠️ **O produzido entrava no estoque valendo ZERO.** Recebia `ultimoValor` do
próprio cadastro, que num item feito na cozinha nunca foi preenchido — ele não
vem de compra. Era por isso que Saldo Estoque mostrava 25 produtos e **R$ 0,00**,
a Margem por Produto não tinha custo e o CMV não fechava pelo lado do produzido.
Agora o custo sai da soma dos insumos consumidos.

⚠️ **O custo unitário divide pelas unidades BOAS, não pelo produzido** (decisão
do dono). Assou 50 e 3 queimaram: os insumos de 50 saíram, mas só 47 entram.
Dividir por 47 joga o custo das perdidas em cima das que sobraram — é como se
apura custo de produção. Por 50 daria um custo que nenhuma unidade real tem.

⚠️ **Os insumos saem pelo PRODUZIDO**, não pelas boas: a farinha das 3 que
queimaram saiu do estoque do mesmo jeito.

⚠️ **Sem ficha, `custoUnitario` é `null` — não zero.** Zero diria "este bolo não
custou nada", que é a mentira que já existia. E `aplicarProducaoDia` **só
sobrescreve `ultimoValor` quando o custo FOI calculado**: zerar um custo que
alguém pôs à mão seria pior.

⚠️ **A perda vira movimento próprio** (`tipo: 'perda'`), não fica embutida no
custo — embutida, ninguém mede a quebra do mês por produto.

⚠️ Dois produtos que usam o mesmo insumo **somam antes de mostrar o saldo**:
cada um sozinho caberia no estoque, juntos não. Mostrar o saldo depois de cada
linha prometeria estoque que não vai existir.

**Pedido da cozinha:** `baixarPedidos` fecha o pedido quando a quantidade bate e
deixa **`parcial`** quando produziu menos — fechar assim mesmo sumiria com a
parte não feita e ninguém lembraria dela. Duas produções somam até fechar.

Tudo num `grupoId` só: entrada do produto, saída dos insumos e perda saem juntos
ou não saem. Linha em branco não é zero, e produzir **nunca é bloqueado** por
cadastro incompleto — o que não baixou vira aviso.

⚠️ Lançar produção **não conserta o passado**: saldo negativo de venda antiga
continua negativo até alguém ajustar a contagem. A tela mostra, não corrige
escondido.

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

### Lista de Compras — blindagem

Fusão própria em `mergeListaCompras.js` (servidor) e bloco dedicado no
`mergeFromServer` (cliente). As duas casam por `id` + `updatedAt`, e a união de
`listaDeletedIds` garante que exclusão nunca "volta".

⚠️ **Toda escrita na lista usa `setDbAndSave`.** Cinco usavam `setDb` puro —
`del`, `limparComprados`, `moverItem`, `renameCat` e `retomarLista` — e caíam na
armadilha nº 0 do §3: feitas durante a janela de outro save, sumiam caladas.

⚠️ **Ler do `d` da gravação, nunca do render.** `limparComprados` tirava os ids
do `comprados` do render e filtrava sobre o `d` do momento da gravação: item que
outro operador marcasse como comprado nesse meio era removido da lista **sem
entrar no tombstone**, e voltava no poll seguinte piscando na tela de todos.
`retomarLista` tinha o mesmo descompasso — e ela apaga TODOS os pendentes.

⚠️ `retomarLista` é destrutiva de propósito (o diálogo avisa), mas os ids que
ela marca como excluídos saem do estado que está sendo escrito — senão apagaria
item que chegou de outro operador entre o clique e a gravação.

#### Fecha sozinha quando acaba

Marcado o ÚLTIMO pendente, a lista está finalizada: ela se arquiva sozinha
depois de **10 segundos de contagem na tela**, e é o arquivamento que apaga os
comprados — "Limpar" e "Fechar Lista" deixaram de ser passo manual obrigatório
(os dois botões continuam, para fechar antes da hora).

⚠️ **A espera não é enfeite.** Um toque errado no último item tiraria da tela,
sem aviso, a lista que a pessoa ainda está conferindo. Mesmo cuidado da ordem
de recarregar do admin (§6).

⚠️ **Cancelar vale pra lista inteira**, não só pra aquela contagem
(`autoCanceladaRef` guarda o `listaAtualId`). Quem cancelou disse "ainda não
terminei"; destravar a cada desmarcar/marcar faria a contagem voltar sem fim.

⚠️ **O id do pedido é DETERMINÍSTICO: `arq-<listaAtualId>`.** Todo aparelho com
a lista aberta arquiva ao mesmo tempo — com `uid()` cada um criaria um registro
e o Arquivo mostraria a mesma compra três vezes. Derivado da lista, a união por
id colapsa os três num só.

⚠️ `arquivarLista` monta o pedido a partir do **`d` da gravação**. O
`listaCompras:[]` cru de antes apagava também o item que outro operador acabou
de adicionar: sem tombstone ele voltava no poll, já órfão da lista fechada.

⚠️ `listaAtualId`/`listaAtualAbertaEm` passaram a ser fundidos **no cliente
também** (antes vinham crus do servidor): durante os ~5s do save direto, o poll
devolvia o id antigo e os itens reapareciam — "fechei e voltou sozinho". Vence
o `abertaEm` estritamente MAIOR; **no empate o servidor vence**, porque a
inicialização de fallback carimba época zero em todos os aparelhos e com `>=`
nenhum convergiria.

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

### Dois comandos de admin — Configurações → Usuários

| botão | carimbo | o que faz |
|---|---|---|
| Desconectar todos os aparelhos | `sessoesValidasApos` | derruba a sessão: todo mundo cai na senha |
| Atualizar todos os aparelhos | `recarregarApos` | recarrega a página: todo mundo passa a rodar a versão publicada |

⚠️ **Deslogar NÃO recarrega.** Depois de digitar a senha o aparelho segue com o
mesmo código antigo na memória. Quando o motivo de derrubar todo mundo é uma
correção recém-publicada — como a da armadilha nº 0 — é o segundo botão que
resolve; o primeiro só pede senha de novo para o mesmo bundle com bug.

Os dois carimbos vencem **pelo MAIOR** nas duas fusões, nunca pelo incoming: um
aparelho postando sua cópia anterior desfaria a ordem que o admin acabou de dar
— e é justamente o aparelho desatualizado o alvo dela.

⚠️ `recarregarApos` é comparado com **`ABA_ABERTA_EM`**, o instante em que a aba
carregou o código. Depois do reload a marca é nova e a ordem antiga não dispara
de novo — não há laço.

⚠️ A recarga **espera 10 segundos** e mostra a contagem. Recarregar na hora faria
o operador perder o que estava digitando — mesmo cuidado do aviso de versão
nova, que só avisa e nunca recarrega sozinho.

**Aviso de versão nova** (`/api/versao`, a cada 2 min): faixa cognac no topo,
"Versão nova disponível — toque para atualizar". É passiva de propósito. Quando
o `recarregarApos` está valendo, a faixa vermelha da ordem do admin substitui a
de versão — duas faixas empilhadas seriam ruído.

---

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

### Cupom IA — provedor (Gemini grátis ou Anthropic)

A leitura de cupom, o teste de status e a conciliação de produtos passam todos
por `iaRequest()` em `new_server.js`, que fala com UM provedor escolhido no
`.env` da VPS:

| variável | efeito |
|---|---|
| `GEMINI_API_KEY` | chave do Google AI Studio (aistudio.google.com). Tem faixa **gratuita** com limite diário de requisições |
| `ANTHROPIC_API_KEY` | chave paga da Anthropic |
| `IA_PROVIDER` | `gemini` ou `anthropic`. **Sem ela, entra o Gemini se `GEMINI_API_KEY` existir, senão a Anthropic** |
| `GEMINI_MODEL` | padrão `gemini-3.8-flash` |
| `GEMINI_MODEL_RESERVA` | padrão `gemini-3.5-flash-lite`. Entra na hora quando o principal falha por sobrecarga (503), limite por minuto ou cota do dia — que é **por modelo** |
| `IA_MODEL` | padrão `claude-haiku-4-5` (~1/3 do preço do Sonnet, lê cupom igual) |

Trocar de provedor é mexer no `.env` e `pm2 restart app-gestao` — nada no
código nem no front. O app inteiro continua falando o formato da Anthropic
(`messages` com blocos image/text, resposta em `content[].text`,
`error.type`); `iaGemini.js` traduz na ida e na volta.

⚠️ Na faixa gratuita do Gemini o Google **pode usar o conteúdo enviado** (foto do
cupom: fornecedor, CNPJ, itens, valores) para melhorar os produtos dele — está
escrito na página de preços. Foi uma escolha consciente pelo custo zero; se isso
mudar de ideia, basta `IA_PROVIDER=anthropic`.

⚠️ Na faixa gratuita o modelo mais novo devolve **503 "overloaded"** em horário
de pico — no primeiro cupom real, o `gemini-3.8-flash` recusou 9 tentativas
seguidas enquanto o Flash-Lite estava livre. Por isso `iaRequest()` percorre
`[GEMINI_MODEL, GEMINI_MODEL_RESERVA]` e só desiste de trocar quando o erro é
da chave ou do pedido (`valeTentarReserva()` em `iaGemini.js`).

⚠️ O 429 do Gemini usa o MESMO texto para "muitas por minuto" e "acabou a cota
do dia" — e o texto menciona "billing details", que casava com `semCredito()`
e mandava o usuário comprar crédito **na Anthropic**. Quem diferencia é o
`quotaId` em `error.details` (`...PerDay...`): cota do dia vira o tipo
próprio `daily_quota_error` — definitivo, sem retry, mensagem em português
dizendo que volta à meia-noite da Califórnia. Chave errada no Gemini chega como
`400 "API key not valid"` (não 401): `iaGemini.js` reconhece pelo texto e vira
`authentication_error`, senão a tela mandaria refotografar o cupom.

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

Seis paletas prontas (`PALETAS_APP`), cada uma com claro E escuro, gravadas em
`db.config.aparenciaApp.paleta` e aplicadas como `data-paleta` no `.app-root`.
O CSS redefine os MESMOS tokens; nenhuma tela precisa saber que existem.

⚠️ **`src/paletas.test.js` mede lendo o `App.tsx`**, não um rascunho à parte —
o que vale é o que está no código. São **156 pares** e nenhum passa abaixo de
4,5:1. O teste também exige que toda paleta defina TODOS os tokens usados: um
faltando, o token base vence e a paleta sai pela metade (uma tag cognac no meio
da Tinta), sem erro nenhum aparecendo. **Adicionou cor? O `npm test` confere.**

#### Tinta: a monocromática

Preto, branco e cinza. Sem cor, o que separa um status do outro é a
**LUMINOSIDADE** — quatro degraus com pelo menos **1,43:1 entre si**. A primeira
tentativa reprovou com 1,18:1 entre info e ok: abaixo de ~1,3 os cinzas leem
como o mesmo cinza e a tag vira enfeite. Há um teste só pra isso.

⚠️ O **perigo é o único invertido** (fundo escuro, texto claro no modo claro; e
o contrário no escuro). É a inversão que faz ele saltar, no lugar do vermelho.

⚠️ Ela só funciona porque **aqui a cor nunca foi a única informação**: a tag traz
o rótulo escrito, o saldo negativo traz o sinal, e a regra de impressão da §8
("status nunca só por cor") já valia. Se alguma tela nova depender só da cor,
essa paleta é a que denuncia.

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

⚠️ **`aparenciaApp` e `coresBotoes` são fundidos como SUB-OBJETOS**, ao lado de
`impressao` e `sortPrefs`, nas duas fusões. A união rasa de `config` faz o local
sobrescrever o objeto inteiro: quem mexeu só na fonte apagaria a paleta que
outro aparelho acabou de escolher, porque as duas moram dentro de
`aparenciaApp`.

⚠️ No `mergeFromServer` isso vai no bloco **`next[emp].config={...}`**, que roda
DEPOIS do spread e sobrescreve qualquer `config` montado antes. Uma primeira
tentativa pôs o tratamento no spread e virou **código morto** — parecia
resolvido e não estava. Se for mexer em `config`, é nesse bloco.

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
