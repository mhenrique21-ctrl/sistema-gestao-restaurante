@echo off
REM ===========================================================================
REM  Ponte Ecletica Food -> App Gestao
REM  Deixe este arquivo na mesma pasta do agent.js e crie um atalho dele em
REM  shell:startup (Win+R) para subir junto com o Windows.
REM ===========================================================================

REM Mesmo segredo que esta no .env do servidor (SEAMA_SERVICE_SECRET).
REM TROQUE a linha abaixo pelo valor real antes de usar.
set SEAMA_SERVICE_SECRET=COLE_O_SEGREDO_AQUI

REM Onde o Ecletica grava os XML. Mude so se a instalacao for em outro lugar.
REM As duas arvores de XML da instalacao real, separadas por ";".
set ECLETICA_XML=C:\Wineclt\ArquivosSistema\XmlVenda;C:\Wineclt\ArquivosSistema\XmlVenda2

REM Formas de pagamento: so preencha se alguma forma da tela do caixa estiver
REM caindo na coluna errada no Gestao. Rode diagnostico.bat para ver quais
REM codigos (tPag) o Ecletica usa. Ex.: ECLETICA_TPAG=05=credito,99=pendura
REM set ECLETICA_TPAG=

REM De quanto em quanto tempo reenvia o total do dia.
set INTERVALO_MIN=2

REM Quantos dias ANTERIORES manter atualizados junto com o dia de hoje.
REM 1 = ontem + hoje (padrao). Protege contra o PC desligar antes do ultimo
REM ciclo e as notas finais do dia nunca subirem. 0 = so o dia de hoje.
set ECLETICA_DIAS_ATRAS=1

REM Descomente e preencha se o MESMO computador tambem emitir pela Seama.
REM set CNPJ_SEAMA=00000000000000

cd /d "%~dp0"
if not exist node_modules ( echo Instalando dependencias... && call npm install )
node agent.js
pause
