# Ponte de impressão 99Food e iFood → App Gestão

O 99Food não abre API pra loja ler o próprio pedido. O que ele tem é a **comanda
que já sai impressa na cozinha**. Este agente se coloca **entre** o aplicativo e
a impressora: recebe o trabalho de impressão, guarda uma cópia e **devolve os
mesmos bytes** pra impressora de verdade.

```
   99Food ──► impressora "99Food Captura" ──┐
                 (grava em ...\99food)      │
                                             ├──► ESTE AGENTE ──► TERMICA (USB)
   iFood  ──► impressora "iFood Captura"  ──┘      guarda          papel da cozinha
                 (grava em ...\ifood)              │
                                                   └──► capturas\*_99food.bin
                                                        capturas\*_ifood.bin
```

Os dois aplicativos imprimem do mesmo jeito, então a mesma ponte serve para os
dois. **Cada um na própria impressora de captura, gravando na própria pasta** —
é o rótulo da pasta que diz de quem é a comanda, e 99Food e iFood são canais
diferentes em Vendas, com taxa diferente.

⚠️ **Uma pasta só para os dois** seria mais fácil de instalar e é justamente o
que não serve: a porta do Windows grava **sempre no mesmo nome**, então dois
pedidos quase juntos se sobrescrevem e a cozinha perde uma comanda. Pastas
separadas viram duas filas independentes.

⚠️ O rótulo da pasta é só a suspeita inicial: quem manda é o **texto da
comanda**. Se a instalação trocar as impressoras, o agente segue o texto e
avisa na tela — seguir o rótulo mandaria o pedido pro canal errado, calado.

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

Ainda sem captura nenhuma, já dá pra testar o repasse. Dois cliques em
**`papel.bat`** — ele manda uma comanda de mentira direto pra impressora.

- **saiu papel** → o lado mais chato está resolvido, pode seguir pro passo 3;
- **não saiu** → o nome em `IMPRESSORA_WINDOWS` está errado. É quase sempre isso:
  rode `impressoras.bat` e copie o **ShareName** exato, espaço incluído.

⚠️ **Pelo PowerShell, `.bat` da pasta atual precisa de `.\` na frente**, e você
tem que estar na pasta certa:

```powershell
cd C:\impressora-agent
.\papel.bat
```

Sem o `.\`, o PowerShell responde *"não é reconhecido como nome de cmdlet"* —
não é o arquivo que está faltando, é ele que não procura no diretório atual.
Dois cliques no arquivo evitam o assunto inteiro.

⚠️ **`node agent.js --papel` direto não serve.** Quem carrega o `config.bat` é o
`.bat`; chamando o `node` na mão, `IMPRESSORA_WINDOWS` não existe e o agente não
sabe pra onde mandar.

### Passo 3 — criar UMA impressora de captura POR aplicativo

Uma impressora do Windows que, em vez de imprimir, **grava o trabalho num
arquivo**. É nela que o aplicativo vai imprimir. Faça este passo **uma vez para
cada aplicativo**, mudando só a pasta e o nome:

| aplicativo | porta (Local Port) | nome da impressora |
|---|---|---|
| 99Food | `C:\ComandasCapturadas\99food\comanda.prn` | `99Food Captura` |
| iFood | `C:\ComandasCapturadas\ifood\comanda.prn` | `iFood Captura` |

1. crie as pastas `C:\ComandasCapturadas\99food` e `C:\ComandasCapturadas\ifood`
2. **Dispositivos e Impressoras** → *Adicionar impressora* →
   *A impressora que eu quero não está na lista* → **Adicionar impressora local**
3. *Criar uma nova porta* → tipo **Local Port** → nome da porta: o caminho da
   tabela acima
4. Driver: **o MESMO da térmica USB** (mesma marca e modelo, escolhido na lista)
5. Nome: o da tabela acima

⚠️ **Pastas separadas, não uma só.** A Local Port grava sempre no mesmo nome de
arquivo; com os dois aplicativos na mesma pasta, dois pedidos quase juntos se
sobrescrevem e um deles nunca sai no papel. Separadas, cada um tem a própria
fila e um não atrapalha o outro.

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

### Passo 4 — apontar os aplicativos e subir o agente

1. `config.bat`: confira `IMPRESSORA_WINDOWS=TERMICA` e as duas pastas —
   `CAPTURA_PASTA_99` e `CAPTURA_PASTA_IFOOD`.
   Só vende num dos dois? Ponha `REM ` na frente da linha do outro.
2. dois cliques em **`iniciar.bat`** (atalho dele em `shell:startup`, via Win+R,
   faz subir junto com o Windows). Uma janela só atende os dois aplicativos —
   duas janelas abertas só dariam uma pra fechar sem ninguém perceber
3. no **99Food**, troque a impressora dos pedidos para `99Food Captura`
4. no **iFood**, troque a impressora dos pedidos para `iFood Captura`

### Passo 5 — conferir sem esperar pedido

Com o `iniciar.bat` aberto numa janela, rode **`teste.bat`** noutra. Ele grava
uma comanda de mentira no caminho de **cada** aplicativo configurado:

- **apareceu arquivo em `capturas\`** e o texto saiu na tela → a captura está certa;
- **saiu papel na térmica** → o repasse está certo;
- o nome do arquivo termina em **`_99food`** ou **`_ifood`** → o rótulo está certo.

Quer testar um só? `teste.bat ifood`.

Com um pedido de verdade do 99Food, a tela mostra também a leitura:

```
🧾 pedido #871001 · Nome do teste · 3 item(ns): 1x Suco Abacaxi c/ Hortelã, …
   total R$ 51,70 · plataforma repassa R$ 0,00 · cobrar do cliente R$ 51,70
```

Com um pedido do **iFood** a tela diz outra coisa, e isso é esperado:

```
ℹ️  comanda do iFood capturada, mas o leitor dela ainda não existe.
    O papel saiu normal; me mande este .bin.
```

O leitor do 99Food foi escrito em cima de uma comanda **real** (#871001). O do
iFood vai nascer do mesmo jeito — **do primeiro `.bin` capturado**, não de um
layout imaginado. É por isso que a captura vem antes: rodar o leitor do 99Food
numa comanda do iFood não daria erro, daria um pedido pela metade, com número e
itens plausíveis e os dois dinheiros vazios.

---

## E se um deles pedir um endereço IP?

Alguns aplicativos só aceitam impressora de rede. Nesse caso aquele aplicativo
não precisa de impressora de captura: no `config.bat`, troque a linha da pasta
dele por uma porta (`CAPTURA_PORTA_99=9100` ou `CAPTURA_PORTA_IFOOD=9101`) e, no
aplicativo, aponte a impressora para o **IP deste PC** (o agente mostra o IP
quando sobe) nessa porta. O repasse para a térmica USB continua igual, pelo
`IMPRESSORA_WINDOWS`.

⚠️ **Portas diferentes para cada um.** Duas fontes na mesma porta não sobem — o
agente avisa `EADDRINUSE` e para, em vez de deixar uma das duas capturando em
silêncio pelas duas.

Os dois jeitos convivem: o 99Food pode imprimir por pasta e o iFood por IP, ao
mesmo tempo, na mesma janela.

Se o app só oferecer impressora **Bluetooth pareada no tablet**, o agente não
alcança: os bytes vão do tablet direto pra impressora, sem passar pelo PC.

---

## Comandos

| Arquivo | Para quê |
|---|---|
| `iniciar.bat` | sobe a ponte e deixa rodando |
| `papel.bat` | manda uma comanda direto pra impressora, sem captura — o 1º teste |
| `impressoras.bat` | lista as impressoras do Windows e o nome do compartilhamento |
| `teste.bat [99food\|ifood]` | manda uma comanda de mentira, pra conferir a instalação |
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

## O pedido vira faturamento em Vendas

Com `SEAMA_SERVICE_SECRET` preenchido no `config.bat`, cada pedido lido sobe
pro Gestão. Sem o segredo, o agente captura, lê e guarda normalmente — só não
envia.

No pedido real de R$ 29,90 com R$ 15,00 de promoção e entrega da parceira:

| coluna | valor | o quê |
|---|---|---|
| `ifood` | 22,89 | o que o cliente pagou pelo app |
| `ifoodTaxa` | 7,99 | entrega da parceira (7,00) + taxa de serviço (0,99) |
| `ifoodLiq` | 14,90 | o que a loja vendeu, **antes da comissão** |
| `dinheiro` | 0,00 | o que o entregador cobraria na porta |

⚠️ **`ifoodLiq` é antes da comissão da plataforma.** A comissão não está na
comanda — ela só aparece no extrato. Isto é "o que vendi", não "o que vou
receber".

⚠️ **O desconto não vira despesa.** Como o faturamento é o que o cliente pagou,
ele já está lá dentro (o cliente pagou 22,89 em vez de 37,89). Lançá-lo também
como despesa contaria o mesmo real duas vezes. Ele fica guardado à parte, só
pra responder "quanto dei de desconto no mês".

⚠️ **A taxa de entrega só é despesa quando quem entrega é a plataforma.** Em
"Entrega Propria" ela fica com a loja. A comanda distingue; quando o leitor não
consegue dizer, a taxa fica de fora e sai aviso — chutar tiraria do faturamento
um dinheiro que entrou na gaveta.

⚠️ **A mesma comanda é impressa duas vezes** (cozinha e sacola) e as duas são
capturadas. A soma do dia descarta repetição por canal + número do pedido; sem
isso o faturamento do dia dobraria em silêncio.

O dia é **reconstruído dos `.json` da pasta `capturas`**, não acumulado na
memória: `/api/venda-pdv` substitui o registro do dia, então um reinício do PC
zeraria um acumulador em memória e o envio seguinte trocaria o dia inteiro
pelos poucos pedidos que chegaram depois. O reenvio acontece a cada pedido, na
subida do agente e a cada 10 minutos — e leva ONTEM junto, para o pedido que
entrou perto da meia-noite.

## O que falta

Nada de código. O que resta é conferir, no fim do mês, o `ifoodLiq` contra o
extrato do iFood: a diferença entre os dois é a comissão, que a comanda não
mostra.
