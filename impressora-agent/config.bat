@echo off
REM ===========================================================================
REM  Ponte de impressao 99Food -> App Gestao :: CONFIGURACAO
REM
REM  ESTE E O UNICO ARQUIVO QUE VOCE EDITA. Ao atualizar o agente, substitua
REM  todos os outros arquivos e MANTENHA ESTE.
REM ===========================================================================

REM ---------------------------------------------------------------------------
REM  1) PARA ONDE A COMANDA VOLTA (o papel da cozinha)
REM ---------------------------------------------------------------------------
REM A impressora desta loja e USB. Porta USB nao se abre como arquivo, entao o
REM unico jeito de mandar bytes crus pra ela e pelo COMPARTILHAMENTO do Windows.
REM
REM   a) Painel de Controle -> Dispositivos e Impressoras
REM   b) botao direito na termica -> Propriedades da impressora -> Compartilhamento
REM   c) marque "Compartilhar esta impressora" e de um nome SEM ESPACO: TERMICA
REM
REM Nao sabe o nome? Rode impressoras.bat: o proprio Windows escreve a lista.
set IMPRESSORA_WINDOWS=TERMICA

REM Se um dia a impressora virar de rede, apague a linha acima e use estas:
REM set IMPRESSORA_IP=192.168.0.50
REM set IMPRESSORA_PORTA=9100

REM ---------------------------------------------------------------------------
REM  2) DE ONDE A COMANDA E CAPTURADA
REM ---------------------------------------------------------------------------
REM  pasta = o 99Food imprime por uma impressora DO WINDOWS que grava o trabalho
REM          num arquivo. E o caminho de quem tem impressora USB. Veja o README.
REM  rede  = o 99Food imprime apontando para um ENDERECO IP. So serve se o
REM          aplicativo pedir IP e porta.
set CAPTURA_MODO=pasta

REM MODO PASTA: a mesma pasta que voce vai apontar na porta da impressora de
REM captura (o README explica como criar). Precisa ser um caminho que o Windows
REM consiga gravar sem pedir senha.
set CAPTURA_PASTA=C:\ComandasCapturadas

REM MODO REDE: porta em que ESTE computador recebe a impressao. 9100 e a padrao.
set CAPTURA_PORTA=9100

REM ---------------------------------------------------------------------------
REM  3) OPCIONAIS
REM ---------------------------------------------------------------------------
REM Onde guardar as capturas (.bin cru + .txt legivel). Em branco = subpasta
REM "capturas" aqui do lado.
REM set CAPTURA_SAIDA=

REM Silencio (em milissegundos) que separa um pedido do proximo na mesma
REM conexao, no modo rede. So mexa se dois pedidos cairem no mesmo arquivo.
REM set CAPTURA_SILENCIO_MS=1500
