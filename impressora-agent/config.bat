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
REM  2) DE ONDE AS COMANDAS SAO CAPTURADAS (99Food e iFood)
REM ---------------------------------------------------------------------------
REM Cada aplicativo imprime na PROPRIA impressora de captura, gravando na
REM PROPRIA pasta. E assim que o agente sabe de quem e cada comanda: 99Food e
REM iFood sao canais diferentes em Vendas, com taxa diferente.
REM
REM ATENCAO: uma pasta so para os dois seria mais facil de instalar e e
REM justamente o que nao serve. A porta do Windows grava SEMPRE no mesmo nome,
REM entao dois pedidos quase juntos se sobrescrevem e a cozinha perde uma
REM comanda. Pastas separadas viram duas filas independentes.
REM
REM Crie as pastas ANTES (o README explica como criar cada impressora).
REM Use so o que voce tem: se a loja ainda nao vende no iFood, deixe a linha
REM dele comentada com REM na frente.
set CAPTURA_PASTA_99=C:\ComandasCapturadas\99food
set CAPTURA_PASTA_IFOOD=C:\ComandasCapturadas\ifood

REM Se algum dos dois so aceitar impressora de REDE (pede IP e porta), troque a
REM linha da pasta dele por uma porta. Os dois jeitos convivem: um aplicativo
REM pode imprimir por pasta e o outro por IP, ao mesmo tempo.
REM set CAPTURA_PORTA_99=9100
REM set CAPTURA_PORTA_IFOOD=9101

REM ---------------------------------------------------------------------------
REM  2b) CONFIGURACAO ANTIGA (uma fonte so, sem rotulo)
REM ---------------------------------------------------------------------------
REM Continua funcionando: quem ja tinha o agente instalado so pro 99Food nao
REM precisa reconfigurar nada. So vale quando NENHUMA linha do item 2 acima
REM estiver preenchida; nesse caso a origem e descoberta pelo TEXTO da comanda.
REM set CAPTURA_MODO=pasta
REM set CAPTURA_PASTA=C:\ComandasCapturadas
REM set CAPTURA_PORTA=9100

REM ---------------------------------------------------------------------------
REM  3) OPCIONAIS
REM ---------------------------------------------------------------------------
REM Onde guardar as capturas (.bin cru + .txt legivel). Em branco = subpasta
REM "capturas" aqui do lado.
REM set CAPTURA_SAIDA=

REM Silencio (em milissegundos) que separa um pedido do proximo na mesma
REM conexao, no modo rede. So mexa se dois pedidos cairem no mesmo arquivo.
REM set CAPTURA_SILENCIO_MS=1500
