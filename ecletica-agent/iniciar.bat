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
set ECLETICA_XML=C:\WinecIt\ArquivosSistema\XmlVenda2

REM De quanto em quanto tempo reenvia o total do dia.
set INTERVALO_MIN=2

REM Descomente e preencha se o MESMO computador tambem emitir pela Seama.
REM set CNPJ_SEAMA=00000000000000

cd /d "%~dp0"
if not exist node_modules ( echo Instalando dependencias... && call npm install )
node agent.js
pause
