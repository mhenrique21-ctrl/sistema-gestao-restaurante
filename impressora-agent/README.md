# Ponte de impressão 99Food → App Gestão

O 99Food não abre API pra loja ler o próprio pedido. O que ele tem é a **comanda
que já sai impressa na cozinha**. Este agente se coloca **entre** o aplicativo e
a impressora: recebe o trabalho de impressão, guarda uma cópia e **devolve os
mesmos bytes** pra impressora de verdade.

```
   99Food  ──►  impressora de CAPTURA  ──►  ESTE AGENTE  ──►  TERMICA (USB)
                  (grava num arquivo)         guarda            papel da cozinha
                                                │
                                                └──►  capturas\*.bin + *.txt
```

A cozinha continua recebendo o papel. Se o repasse falhar, a captura acontece
assim mesmo e dá pra reimprimir depois — é por isso que ele é intermediário e
não substituto.

## Estado: captura + leitura do pedido

Cada trabalho capturado vira até quatro arquivos em `capturas\`:

| arquivo | o que é |
|---|---|
| `.bin` | os bytes crus, exatamente como chegaram |
| `.txt` | o texto legível |
| `.png` | a comanda montada como imagem, quando ela vem **desenhada** |
| `.json` | o pedido já lido: número, cliente, itens, valores |

O leitor foi escrito em cima de uma comanda **real** (pedido #871001), não de um
layout imaginado — e ele não adivinha: linha que não casa com nada aparece como
*não entendi* na tela, em vez de virar um pedido errado em silêncio. O agente
ainda **não manda nada pro Gestão**: para onde o valor entra em Vendas depende de
uma decisão que não é do código (veja abaixo).

O `.bin` cru é guardado junto com o resto porque tudo o mais pode ser refeito a
partir dele: se a impressora usar outra tabela de caracteres, ou o leitor
melhorar, é ele que permite reler os pedidos antigos sem esperar pedido novo
(`ler.bat capturas\<arquivo>.bin`).

### Os dois dinheiros da comanda

```
Pagamento via 99Food     R$0,00     ← o que a plataforma repassa
Cobrar do cliente       R$51,70     ← o que o entregador recebe na porta
```

Somar os dois **dobra** o faturamento do dia; trocar um pelo outro joga dinheiro
de caixa na conta a receber do 99Food. O leitor devolve os dois separados, e a
conferência avisa quando eles não fecham com o total.

### Se a comanda vier como imagem

A comanda do 99Food tem fonte proporcional e caixa de canto arredondado — coisa
que impressora térmica não desenha sozinha. Quando o aplicativo manda a comanda
**pronta, como imagem**, o `.txt` sai vazio: aí o agente monta o `.png` e avisa
na tela. O papel continua saindo igual; o que falta nesse caso é o texto, e é
disso que eu preciso saber pra escolher o caminho seguinte.

---

## Instalação com impressora USB

São dois lados: **devolver** a comanda pro papel, e **capturar** o que o 99Food
manda imprimir. Faça nesta ordem — o primeiro dá pra testar sozinho.

### Passo 1 — dar um caminho à impressora USB

Porta USB **não se abre como arquivo** (ao contrário da LPT antiga). O jeito de
mandar bytes crus pra uma térmica USB no Windows é pelo **compartilhamento**:

1. Painel de Controle → **Dispositivos e Impressoras**
2. botão direito na térmica → **Propriedades da impressora** → aba
   **Compartilhamento**
3. marque *Compartilhar esta impressora* e dê um nome **sem espaço**: `TERMICA`

Não precisa liberar nada na rede — quem vai usar esse caminho é o próprio PC.

Rode **`impressoras.bat`**: o Windows escreve a lista com o `ShareName` de cada
uma. O nome que vai no `config.bat` é esse, copiado da tela — não adivinhado.

### Passo 2 — conferir o caminho de volta

Ainda sem captura nenhuma, já dá pra testar o repasse:

```
reimprimir.bat capturas\exemplo.bin
```

Se sair papel, o lado que importa está resolvido. (Se ainda não existe captura
nenhuma, siga pro passo 4 e volte aqui.)

### Passo 3 — criar a impressora de CAPTURA

Uma segunda impressora no Windows, que em vez de imprimir **grava o trabalho num
arquivo**. É nela que o 99Food vai imprimir.

1. **Dispositivos e Impressoras** → *Adicionar impressora* →
   *A impressora que eu quero não está na lista* → **Adicionar impressora local**
2. *Criar uma nova porta* → tipo **Local Port** → nome da porta:
   `C:\ComandasCapturadas\comanda.prn`
   (crie a pasta `C:\ComandasCapturadas` antes)
3. Driver: **o MESMO da térmica USB** (mesma marca e modelo, escolhido na lista)
4. Nome: `99Food Captura`

⚠️ O driver tem que ser o mesmo **de propósito**: assim os bytes capturados são
exatamente os que a térmica entende, e o repasse reproduz a comanda **idêntica**
à de hoje. Com um driver diferente o papel sairia com outra cara.

Se o `.txt` sair vazio (comanda mandada como imagem), refaça este passo com
**Generic / Text Only**: esse driver descarta a formatação e entrega texto puro.
A comanda no papel fica mais simples, mas fica legível — e aí o pedido entra no
Gestão.

⚠️ **Não escolha a porta `FILE:`**: ela abre uma janela pedindo o nome do arquivo
a cada impressão, e ninguém vai estar no PC pra responder às 20h.

⚠️ A Local Port grava **sempre no mesmo nome**. O agente lê e apaga o arquivo na
hora, e guarda a assinatura do que já leu pra não capturar o mesmo pedido duas
vezes — mas é por isso que ele precisa estar rodando.

### Passo 4 — apontar o 99Food e subir o agente

1. `config.bat`: confira `IMPRESSORA_WINDOWS=TERMICA`,
   `CAPTURA_MODO=pasta` e `CAPTURA_PASTA=C:\ComandasCapturadas`
2. dois cliques em **`iniciar.bat`** (atalho dele em `shell:startup`, via Win+R,
   faz subir junto com o Windows)
3. no 99Food, troque a impressora dos pedidos para **99Food Captura**

### Passo 5 — conferir sem esperar pedido

Com o `iniciar.bat` aberto numa janela, rode **`teste.bat`** noutra. Ele grava
uma comanda de mentira no mesmo caminho que o 99Food usaria:

- **apareceu arquivo em `capturas\`** e o texto saiu na tela → a captura está certa;
- **saiu papel na térmica** → o repasse está certo.

Com um pedido de verdade, a tela mostra também a leitura:

```
🧾 pedido #871001 · Nome do teste · 3 item(ns): 1x Suco Abacaxi c/ Hortelã, …
   total R$ 51,70 · plataforma repassa R$ 0,00 · cobrar do cliente R$ 51,70
```

Se os dois acontecerem, é só esperar o primeiro pedido de verdade.

---

## E se o 99Food pedir um endereço IP?

Alguns aplicativos só aceitam impressora de rede. Nesse caso não precisa da
impressora de captura: ponha `CAPTURA_MODO=rede` no `config.bat` e, no 99Food,
aponte a impressora para o **IP deste PC** (o agente mostra o IP quando sobe) na
porta 9100. O repasse para a térmica USB continua igual, pelo
`IMPRESSORA_WINDOWS`.

Se o app só oferecer impressora **Bluetooth pareada no tablet**, o agente não
alcança: os bytes vão do tablet direto pra impressora, sem passar pelo PC.

---

## Comandos

| Arquivo | Para quê |
|---|---|
| `iniciar.bat` | sobe a ponte e deixa rodando |
| `impressoras.bat` | lista as impressoras do Windows e o nome do compartilhamento |
| `teste.bat` | manda uma comanda de mentira, pra conferir a instalação |
| `ler.bat <arquivo.bin>` | mostra o texto de uma captura guardada |
| `reimprimir.bat <arquivo.bin>` | manda uma captura pra impressora |

## Por que o texto é decodificado em CP850

Impressora térmica não fala UTF-8: cada caractere acentuado é **um byte** de uma
tabela de código, quase sempre CP850 no Brasil. Lido como UTF-8, "PÃO DE QUEIJO"
vira lixo no meio da palavra — e nome de produto com lixo não casa com o
cadastro. A conversão fica em `escpos.js`, com testes.

O mesmo arquivo também **pula os comandos** de negrito, corte, gaveta, logo e
código de barras. Sem isso o parâmetro do comando vira caractere solto colado no
nome do item, e o logo (imagem) vira páginas de sujeira.

O repasse usa `copy /b`, e o `/b` não é detalhe: sem ele o Windows trata o byte
`0x1A` como fim de arquivo, e esse byte aparece no meio de ESC/POS — a comanda
sairia cortada no meio, sem erro nenhum.

## Próximo passo

Falta ligar o pedido ao Gestão, e o que trava isso não é código: é **onde o
valor entra em Vendas**. Pedido pago no aplicativo é faturamento do canal 99Food,
com taxa e líquido. Pedido pago em dinheiro na porta é dinheiro que chega ao
caixa — e a comanda distingue os dois, mas quem decide em que coluna cada um
entra é o dono.
