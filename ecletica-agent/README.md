# Ponte Eclética Food → App Gestão

Lê os XML de NFC-e que o Eclética já grava no disco do computador do caixa e
manda o faturamento do dia pro App Gestão. **Sem API e sem tocar no banco do
Eclética** — só leitura de arquivo.

## Arquivos

| Arquivo | Para quê |
|---|---|
| `config.bat` | **O único que você edita.** Segredo, caminhos, formas de pagamento |
| `iniciar.bat` | Sobe a ponte e deixa rodando |
| `diagnostico.bat` | Responde "por que não apareceu venda nenhuma" |
| `backfill.bat` | Envia um período inteiro que já está no disco |
| `agent.js` | O agente |

Ao atualizar: substitua tudo **menos o `config.bat`**. Ele existe exatamente por
isso — antes, cada atualização apagava o segredo junto com o resto.

## Instalação (no computador do caixa)

1. Instale o Node.js LTS: <https://nodejs.org> (marque "Add to PATH").
2. Copie a pasta `ecletica-agent` inteira para `C:\ecletica-agent`.
3. Abra `config.bat` no Bloco de Notas e troque `COLE_O_SEGREDO_AQUI` pelo
   valor de `SEAMA_SERVICE_SECRET` que está no `.env` do servidor.
4. Dê dois cliques em `iniciar.bat`. Na primeira vez ele instala a dependência
   sozinho e começa a enviar.
5. Para subir junto com o Windows: `Win+R` → `shell:startup` → cole ali um
   **atalho** do `iniciar.bat` (atalho, não uma cópia).

Para conferir se chegou: no servidor, `pm2 logs app-gestao` mostra uma linha
`[venda-pdv] OK — CONFRARIA <data> [pdv_ecletica]` a cada envio.

## Preencher o histórico

`backfill.bat` envia um período inteiro que já está no disco — o que aconteceu
antes da ponte existir, ou um período a refazer depois de corrigir o mapa de
formas. Ele **simula primeiro**, mostra dia a dia, e só grava se você digitar
`ENVIAR`. Repetir é seguro: o Gestão substitui o registro de cada dia, não soma.

Pela linha de comando: `node agent.js --enviar 2026-09-01 2026-09-12 [--simular]`.

## Variáveis (todas no `config.bat`)

| Variável | Padrão | Para quê |
|---|---|---|
| `SEAMA_SERVICE_SECRET` | — | **Obrigatória.** Mesmo segredo do `.env` do servidor |
| `ECLETICA_EVENTOS` | `...\NFCe` | Onde procurar evento de cancelamento |
| `ECLETICA_XML` | `...\XmlVenda;...\XmlVenda2` | Raízes dos XML, separadas por `;` |
| `GESTAO_URL` | `https://gestao.confrariacafe.com` | Servidor do Gestão |
| `INTERVALO_MIN` | `2` | De quanto em quanto tempo reenvia o dia |
| `ECLETICA_DIAS_ATRAS` | `1` | Dias anteriores mantidos atualizados junto com hoje |
| `CNPJ_SEAMA` | — | Só se o mesmo PC emitir pela Seama também |
| `ECLETICA_FONTE` | `ecletica` | Etiqueta da origem (ver abaixo) |
| `ECLETICA_TPAG` | — | Corrige o mapa de formas, ex.: `05=credito,99=pendura` |

## Decisões que não são óbvias

**Ele mantém ontem atualizado, não só hoje.** Antes mandava só o dia corrente e
nunca voltava atrás: se o PC do caixa fosse desligado antes do último ciclo, as
notas finais do dia ficavam no disco e não subiam nunca mais — em silêncio, e a
diferença só apareceria no fechamento do mês. Como o envio substitui o registro
do dia, reenviar ontem é inofensivo. `ECLETICA_DIAS_ATRAS` amplia a janela (teto
de 31); `0` volta ao comportamento antigo.

Um POST idêntico não é repetido a cada ciclo — o agente guarda o último valor
enviado por dia e só manda de novo quando muda. Essa memória é do processo:
reiniciar reenvia tudo uma vez, o que serve de reconciliação.

**Reprocessar não duplica.** `/api/venda-pdv` *substitui* o registro do dia
(chaveado por data + origem), não soma. O agente relê todos os XML do dia e
manda o total; mandar de novo manda o mesmo número. Por isso não existe
controle de "arquivo já processado" — que se perderia quando o PC reiniciasse.

**Cada emissor tem origem própria.** A Confraria tem dois sistemas mandando
venda do mesmo dia: o `delivery-backend` (origem `pdv`) e este agente (origem
`pdv_ecletica`). Como o endpoint substitui o registro, os dois na mesma origem
se apagariam a cada ciclo e o faturamento do dia ficaria alternando entre um
número e outro — sem erro nenhum em log, porque cada gravação isolada está
certa. Na tela de Vendas aparecem duas linhas no dia, e o total soma as duas.

**Ele lê DUAS pastas e deduplica por chave.** A instalação real tem
`C:\Wineclt\ArquivosSistema\XmlVenda` e `...\XmlVenda2` lado a lado, as duas com
árvore `ano\mês`, e não dá pra prever qual recebe a nota do dia — apontar pra
uma só faz venda sumir em silêncio. Como a mesma nota aparece em mais de um
arquivo (nas duas árvores, e ainda em `NFCe\XmlDestinatario`), a soma é
deduplicada pela chave da NFC-e: ler duas pastas sem isso dobraria o
faturamento. Para acrescentar outra pasta, separe por `;`.

⚠️ Nunca aponte para uma pasta de **backup** (ex.: `Desktop\BKP Cafeteria\...`):
notas antigas entrariam no faturamento de hoje.

**Formas de pagamento em duas camadas.** O `tPag` da NFC-e vira uma **forma**
(dinheiro, crédito, débito, PIX, pendura, outros) — que é o detalhe que aparece
no Gestão — e a forma vira um **balde** (dinheiro × maquininha), que é o que os
cálculos antigos usam. Separar as duas coisas é o que evita o erro do mapa
anterior, que jogava "crédito da loja" na maquininha.

**Pendura fica fora dos baldes.** É venda faturada com recebimento adiado: entra
no **total** do dia (é o número que o caixa vê ao fechar), mas não em dinheiro
nem em maquininha — não é dinheiro na gaveta nem valor a conferir no extrato do
cartão. Mesma regra que o `delivery-backend` já aplica, para as duas fontes
contarem igual.

PIX entra no balde *maquininha* porque a distinção que importa ali é
gaveta × eletrônico, e é assim que o `delivery-backend` já classifica. O valor
de PIX continua visível separado na linha de formas.

Nesta instalação (confirmado pelo diagnóstico): o Eclética emite **todo cartão
como `03`** — não existe `04`, então crédito e débito não são separáveis pelo
XML; a coluna "crédito" é, na prática, "cartão". E usa **`99` com a descrição
`"PENDURA"`**, por isso o `iniciar.bat` já vem com `ECLETICA_TPAG=99=pendura`.

`diagnostico.bat` lista os códigos `tPag` realmente encontrados no mês. Se uma
forma da tela do caixa estiver caindo na coluna errada, corrija com
`ECLETICA_TPAG` no `iniciar.bat` — sem tocar no código.

**Manda também os produtos vendidos.** O `<det>` da nota traz código, descrição,
quantidade, unidade e valor de cada item — o dado que os relatórios de Produtos,
Curva ABC e Margem do Gestão sempre souberam usar e nunca tiveram da venda do
balcão. Vai **agregado por dia e por produto**, não item a item: o Gestão
sincroniza o documento inteiro entre os aparelhos a cada ~100ms, e guardar cada
linha de cada cupom engordaria esse tráfego todo dia, para sempre.

O agrupamento é pelo **código** do produto quando ele existe: reeditar o cadastro
no Eclética muda o nome, e o mesmo item viraria dois no ranking.

⚠️ A soma dos itens **não fecha** com o total da venda: `vProd` é antes de
desconto e sem gorjeta. É de propósito — para ranking e margem o que importa é o
peso relativo de cada produto, e ratear gorjeta por item inventaria um número
que não está na nota. O faturamento continua saindo do `vNF`.

**O total sai de `<total><ICMSTot><vNF>`.** Existe um `<vProd>` dentro de cada
item também; pegar "o primeiro do documento" traria o valor do primeiro produto
em vez do total da venda.

**A gorjeta sai do texto do `infCpl`, não do `<vTroco>`.** O Eclética declara a
gorjeta nos dois lugares, mas `vTroco` é ambíguo: numa venda em dinheiro ele é
o troco de verdade, e somá-lo contaria como faturamento o dinheiro que voltou
pro cliente. Por decisão do dono, a gorjeta entra **dentro do faturamento**
(venda de R$ 84,00 + R$ 8,40 de gorjeta sobe como R$ 92,40).

**O cancelamento mora noutra árvore.** O Eclética não grava o evento junto da
nota: o diagnóstico de setembro mostrou 764 arquivos em `XmlVenda`/`XmlVenda2` e
**zero** descartados. Os documentos de transmissão ficam em
`ArquivosSistema\NFCe`, então é lá que o agente procura o cancelamento — e dali
só sai cancelamento, nunca venda, para uma cópia do destinatário não virar
faturamento extra. Dois cuidados de desempenho: só arquivos que contêm
`tpEvento` são interpretados (a pasta de Log tem milhares de envelopes que não
interessam), e só os recentes em relação ao mês procurado.

**Venda cancelada fica de fora**, por dois caminhos — porque emissores fazem de
formas diferentes e não dá pra saber de antemão qual o seu usa:
- evento de cancelamento (`tpEvento` 110111 com retorno 135/155) em qualquer
  lugar da árvore do mês;
- nota dentro de pasta `Cancelados` / `Inutilizados` / `Denegados` / etc.

Por isso a varredura percorre o **mês inteiro**, não só `Emitidos`: o evento de
cancelamento não fica junto da nota, e o layout de pastas muda com a versão.

## "Não aparece venda nenhuma"

Dê dois cliques em `diagnostico.bat` (ou rode `node agent.js --diagnostico`).
Ele não envia nada — só lê e mostra:

- se a pasta do mês existe (se não existe, o `ECLETICA_XML` está errado);
- quantos XML tem na árvore;
- quais datas ele encontrou, com quantas vendas em cada;
- **por que cada arquivo foi descartado**, contado por motivo.

Para um dia específico: `diagnostico.bat 2026-09-11`.

Isso existe porque "nenhuma venda hoje", "a pasta nem existe" e "li 300 notas e
recusei todas por CNPJ" davam a mesma mensagem na tela — três problemas com
soluções completamente diferentes.

## Testes

```bash
node --test ecletica-agent/
```

Cobrem as pegadinhas acima — inclusive o caso do troco em dinheiro sendo
confundido com gorjeta, que inflaria o faturamento em silêncio.
