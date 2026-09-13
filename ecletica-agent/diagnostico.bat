@echo off
REM Responde "por que nao apareceu venda nenhuma": diz se as pastas existem,
REM quantos XML tem, quais datas achou, quais codigos de pagamento o Ecletica
REM usa e por que cada arquivo foi descartado. Nao envia nada ao servidor.
REM Para um dia especifico: diagnostico.bat 2026-09-11
cd /d "%~dp0"
call config.bat
if not exist node_modules ( echo Instalando dependencias... && call npm install )
node agent.js --diagnostico %1
pause
