@echo off
REM ===========================================================================
REM  Ponte de impressao 99Food -> App Gestao :: CONFIGURACAO
REM
REM  ESTE E O UNICO ARQUIVO QUE VOCE EDITA. Ao atualizar o agente, substitua
REM  todos os outros arquivos e MANTENHA ESTE.
REM ===========================================================================

REM --- COMO O 99FOOD IMPRIME NESTA LOJA -------------------------------------
REM  rede  = o aplicativo/tablet imprime apontando para um ENDERECO IP.
REM          E o caso da impressora de rede (tem cabo de rede ou Wi-Fi propria).
REM  pasta = o aplicativo imprime pelo Windows, e um redirecionador grava o
REM          trabalho num arquivo. Ai o agente so vigia a pasta.
REM  Na duvida comece com "rede": e o unico modo que da pra testar sozinho.
set CAPTURA_MODO=rede

REM --- MODO REDE ------------------------------------------------------------
REM Porta em que ESTE computador vai receber a impressao. 9100 e a padrao de
REM impressao crua; no 99Food voce aponta a impressora para o IP deste PC
REM (o agente mostra o IP na tela quando sobe) com esta porta.
set CAPTURA_PORTA=9100

REM IP da impressora DE VERDADE, para onde o agente repassa os mesmos bytes.
REM SEM ISSO A COZINHA FICA SEM PAPEL. Se a impressora nao for de rede, veja o
REM README - da pra repassar por uma impressora compartilhada do Windows.
set IMPRESSORA_IP=
set IMPRESSORA_PORTA=9100

REM --- MODO PASTA -----------------------------------------------------------
REM Pasta onde o redirecionador grava o trabalho de impressao.
REM set CAPTURA_PASTA=C:\ComandasCapturadas

REM --- COMUM ----------------------------------------------------------------
REM Onde guardar as capturas (.bin cru + .txt legivel). Em branco = subpasta
REM "capturas" aqui do lado.
REM set CAPTURA_SAIDA=

REM Silencio (em milissegundos) que separa um pedido do proximo na mesma
REM conexao. So mexa se dois pedidos estiverem caindo no mesmo arquivo.
REM set CAPTURA_SILENCIO_MS=1500
