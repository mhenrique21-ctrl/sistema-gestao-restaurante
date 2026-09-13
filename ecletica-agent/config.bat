@echo off
REM ===========================================================================
REM  Ponte Ecletica Food -> App Gestao :: CONFIGURACAO
REM
REM  ESTE E O UNICO ARQUIVO QUE VOCE EDITA. Ao atualizar o agente, substitua
REM  todos os outros arquivos e MANTENHA ESTE - e ele que guarda o segredo.
REM ===========================================================================

REM Mesmo segredo que esta no .env do servidor (SEAMA_SERVICE_SECRET).
set SEAMA_SERVICE_SECRET=COLE_O_SEGREDO_AQUI

REM As duas arvores de XML desta instalacao, separadas por ";".
set ECLETICA_XML=C:\Wineclt\ArquivosSistema\XmlVenda;C:\Wineclt\ArquivosSistema\XmlVenda2

REM Formas de pagamento. O 99 e "Outros" na tabela da SEFAZ, entao o codigo
REM sozinho nao diz nada; aqui o proprio Ecletica escreve "PENDURA" junto dele
REM (confirmado pelo diagnostico em 13/09/2026). Sem esta linha a pendura cai
REM no balde maquininha e a conferencia com a operadora nao fecha.
set ECLETICA_TPAG=99=pendura

REM De quanto em quanto tempo reenvia o total do dia.
set INTERVALO_MIN=2

REM Quantos dias ANTERIORES manter atualizados junto com hoje. 1 = ontem+hoje.
set ECLETICA_DIAS_ATRAS=1

REM Onde procurar o evento de cancelamento. Em branco = ao lado dos XML
REM (ArquivosSistema\NFCe), que e onde esta instalacao guarda.
REM set ECLETICA_EVENTOS=

REM Descomente e preencha se o MESMO computador tambem emitir pela Seama.
REM set CNPJ_SEAMA=00000000000000
