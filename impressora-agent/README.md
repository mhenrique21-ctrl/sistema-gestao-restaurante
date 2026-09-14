# Ponte de impressão 99Food → App Gestão

O 99Food não abre API pra loja ler o próprio pedido. O que ele tem é a **comanda
que já sai impressa na cozinha**. Este agente se coloca **entre** o aplicativo e
a impressora: recebe o trabalho de impressão, guarda uma cópia e **repassa os
mesmos bytes** pra impressora de verdade.

```
   99Food                  ESTE AGENTE                    impressora
  (tablet/app)  ──────►  guarda + repassa   ──────►   comanda da cozinha
                              │
                              └──► capturas\*.bin (cru) + *.txt (legível)
```

A cozinha continua recebendo o papel. Se a impressora estiver desligada ou fora
da rede, a captura acontece assim mesmo e dá pra reimprimir depois — é por isso
que ele é intermediário e não substituto.

## Estado: FASE 1 — captura

Hoje o agente **captura e mostra** a comanda. Ele ainda **não** interpreta o
pedido nem manda nada pro Gestão, e isso é de propósito: o layout da comanda do
99Food é desconhecido daqui, e escrever o leitor antes de ver uma comanda real é
exatamente o erro que custou três idas e vindas na ponte do Eclética.

O `.bin` cru é guardado junto com o `.txt` justamente porque o `.txt` pode ser
refeito: se a impressora usar outra tabela de caracteres, ou o leitor melhorar,
é o `.bin` que permite reler os pedidos antigos sem esperar pedido novo
(`ler.bat capturas\<arquivo>.bin`).

## 1. Descobrir COMO o 99Food imprime nesta loja

Antes de configurar qualquer coisa, é preciso saber por onde a comanda sai.
No aplicativo do 99Food, abra as configurações de impressora e veja o que ele
pede:

| O que o app pede | Modo | O que fazer |
|---|---|---|
| Um **endereço IP** (ex.: 192.168.0.50) e porta 9100 | `rede` | É o caminho fácil. Continue no passo 2. |
| Uma impressora **Bluetooth** (parear com o tablet) | — | O agente não alcança: os bytes vão do tablet direto pra impressora, sem passar pela rede. Seria preciso uma impressora de rede, ou capturar pelo Windows. |
| Uma impressora **do Windows** (o pedido sai pelo PC) | `pasta` | Passo 4. |

Se já existe impressora de rede, o IP dela costuma sair na própria impressora:
desligue, segure o botão de avanço de papel e ligue — quase todas imprimem uma
página de autoteste com o endereço.

## 2. Instalar (modo rede)

1. Copie esta pasta pro computador do caixa (o mesmo do agente do Eclética).
2. Abra `config.bat` no Bloco de Notas e preencha:
   - `CAPTURA_MODO=rede`
   - `IMPRESSORA_IP=` o IP da impressora **de verdade**
3. Dê dois cliques em `iniciar.bat`. Ele mostra na tela o **IP deste PC**.
4. No 99Food, troque o endereço da impressora: em vez do IP da impressora,
   ponha o **IP deste PC**, porta 9100.

A partir daí todo pedido passa por aqui e sai no papel como antes.

## 3. Conferir sem esperar pedido

Com o `iniciar.bat` aberto numa janela, rode `teste.bat` noutra. Ele manda uma
comanda de mentira pro próprio agente:

- **saiu papel na impressora** → o repasse está certo;
- **apareceu arquivo em `capturas\`** → a captura está certa.

Se os dois acontecerem, a instalação está pronta e é só esperar o primeiro
pedido de verdade.

## 4. Instalar (modo pasta)

Quando o 99Food imprime pelo Windows, o caminho é fazer o Windows gravar o
trabalho num arquivo, e o agente vigia a pasta:

1. Painel de Controle → Dispositivos e Impressoras → Adicionar impressora →
   **Adicionar uma impressora local**;
2. porta: **FILE: (Imprimir em arquivo)** ou um redirecionador de porta que
   grave numa pasta fixa;
3. driver: **Generic / Text Only** — é o que faz o Windows mandar o texto sem
   converter pra desenho;
4. no `config.bat`: `CAPTURA_MODO=pasta` e `CAPTURA_PASTA=` a pasta escolhida.

Nesse modo o agente **não** repassa nada — quem imprime é o Windows.

## Comandos

| Arquivo | Para quê |
|---|---|
| `iniciar.bat` | sobe a ponte e deixa rodando (atalho em `shell:startup` sobe com o Windows) |
| `teste.bat` | manda uma comanda de mentira, pra conferir a instalação |
| `ler.bat <arquivo.bin>` | mostra o texto de uma captura guardada |
| `reimprimir.bat <arquivo.bin>` | reenvia pra impressora (quando ela estava desligada) |

## Por que o texto é decodificado em CP850

Impressora térmica não fala UTF-8: cada caractere acentuado é **um byte** de uma
tabela de código, quase sempre CP850 no Brasil. Lido como UTF-8, "PÃO DE QUEIJO"
vira lixo no meio da palavra — e nome de produto com lixo não casa com o
cadastro. A conversão fica em `escpos.js`, com testes.

O mesmo arquivo também **pula os comandos** de negrito, corte, gaveta, logo e
código de barras. Sem isso o parâmetro do comando vira caractere solto colado no
nome do item, e o logo (imagem) vira páginas de sujeira.

## Próximo passo

Assim que existir **uma comanda real capturada**, o leitor do pedido nasce em
cima dela: número do pedido, cliente, itens, observações, taxa e total, indo pro
Gestão pelo mesmo caminho que o Eclética já usa. Até lá, o agente só guarda.
