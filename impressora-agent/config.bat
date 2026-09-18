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
REM A comanda do 99Food sai na ELGIN i8, que e USB (PortName USB001). Porta USB
REM nao se abre como arquivo, entao o unico jeito de mandar bytes crus pra ela e
REM pelo COMPARTILHAMENTO do Windows - e ela JA ESTA compartilhada.
REM
REM O valor abaixo e o ShareName, copiado do impressoras.bat. Se um dia nao
REM bater, rode impressoras.bat de novo: o proprio Windows escreve a lista.
REM
REM ATENCAO: o ESPACO no nome esta certo. O agente poe as aspas sozinho - nao
REM troque por um nome sem espaco, ou deixa de casar com o que o Windows usa.
set IMPRESSORA_WINDOWS=ELGIN i8

REM IMPRESSORA DE REDE: as EPSON da loja tem IP (COZINHA 192.168.100.180,
REM BALCAO 192.168.100.88). Se um dia a comanda passar a sair numa delas, use
REM estas duas linhas no lugar da de cima - por IP o repasse sai EM FLUXO, byte
REM a byte, enquanto pela impressora compartilhada o spooler so aceita o
REM trabalho inteiro e a cozinha espera ~1,5s a mais.
REM
REM Preencha SO UM dos dois: IMPRESSORA_WINDOWS ou IMPRESSORA_IP.
REM set IMPRESSORA_IP=192.168.100.180
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
REM  3) ENVIO PRO APP GESTAO
REM ---------------------------------------------------------------------------
REM Com o segredo preenchido, cada pedido lido vira faturamento do canal em
REM Vendas. SEM ele o agente captura, le e guarda normalmente - so nao envia.
REM
REM O valor e o mesmo SEAMA_SERVICE_SECRET que esta no .env do servidor (e no
REM config.bat do ecletica-agent, se ele ja roda neste PC).
set SEAMA_SERVICE_SECRET=COLE_O_SEGREDO_AQUI

REM De qual empresa sao estas comandas.
set EMPRESA=CONFRARIA

REM O ENVIO PRO GESTAO ESTA DESLIGADO (decisao do dono, 18/09/2026).
REM
REM A comanda impressa NAO consegue dar o liquido do canal: o desconto que sai
REM no papel soma o incentivo do iFood (que ele repoe) com o da loja (que ela
REM banca), o cancelamento acontece DEPOIS do papel sair, e a taxa do plano nao
REM esta na comanda. Conferido contra o relatorio real do dia 16/09/2026: a
REM melhor conta possivel pela comanda errava R$ 63,92 no dia.
REM
REM Quem lanca Vendas agora e: App Gestao -> Vendas -> Importar relatorio.
REM
REM O agente continua CAPTURANDO e REPASSANDO a comanda pra impressora - o
REM papel da cozinha nao muda em nada, e os .bin ficam guardados.
REM
REM ATENCAO: nao apague o SEAMA_SERVICE_SECRET pra desligar o envio. Sem ele o
REM log diz "sem segredo", que e a mesma frase de quem nao terminou de
REM instalar, e a TRANSCRICAO da comanda em imagem para de funcionar.
REM Pra religar o envio um dia: troque por "sim".
set COMANDAS_ENVIAR=nao

REM ---------------------------------------------------------------------------
REM  3b) A COMISSAO DE CADA PLATAFORMA (em % da venda liquida)
REM ---------------------------------------------------------------------------
REM A comanda NAO traz a comissao - ela so aparece no extrato. Mas ela esta no
REM CONTRATO, e sem ela o total do dia sobe com o valor BRUTO: o faturamento do
REM mes fica inflado em quase um terco no iFood, calado.
REM
REM A conta e sempre nesta ordem:
REM    venda liquida = pago pelo app - taxa de servico - entrega da plataforma
REM    liquido       = venda liquida x (1 - comissao%)
REM
REM ATENCAO: trocou de plano, ganhou promocao de taxa, mudou de categoria?
REM Mude aqui e rode o reprocessar.bat - ele refaz os dias com a taxa nova.
set TAXA_IFOOD=27
set TAXA_99FOOD=10

REM So mude se o endereco do Gestao mudar.
REM set GESTAO_URL=https://gestao.confrariacafe.com

REM ---------------------------------------------------------------------------
REM  4) OPCIONAIS
REM ---------------------------------------------------------------------------
REM Onde guardar as capturas (.bin cru + .txt legivel). Em branco = subpasta
REM "capturas" aqui do lado.
REM set CAPTURA_SAIDA=

REM Silencio (em milissegundos) que separa um pedido do proximo na mesma
REM conexao, no modo rede. So mexa se dois pedidos cairem no mesmo arquivo.
REM set CAPTURA_SILENCIO_MS=1500
