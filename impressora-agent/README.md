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

## Estado: FASE 1 — captura

Hoje o agente **captura e mostra** a comanda. Ele ainda **não** interpreta o
pedido nem manda nada pro Gestão, e isso é de propósito: o layout da comanda do
99Food é desconhecido daqui, e escrever o leitor antes de ver uma comanda real é
exatamente o erro que custou três idas e vindas na ponte do Eclética.

O `.bin` cru é guardado junto com o `.txt` justamente porque o `.txt` pode ser
refeito: se a impressora usar outra tabela de caracteres, ou o leitor melhorar,
é o `.bin` que permite reler os pedidos antigos sem esperar pedido novo
(`ler.bat capturas\<arquivo>.bin`).

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
3. Fabricante **Generic** → **Generic / Text Only**
   — é o driver que manda o texto sem converter a comanda em desenho
4. Nome: `99Food Captura`

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

Assim que existir **uma comanda real capturada**, o leitor do pedido nasce em
cima dela: número do pedido, cliente, itens, observações, taxa e total, indo pro
Gestão pelo mesmo caminho que o Eclética já usa. Até lá, o agente só guarda.
