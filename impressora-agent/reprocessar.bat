@echo off
REM Rele TODAS as capturas guardadas com o leitor ATUAL e refaz os .json,
REM depois reenvia os dias afetados pro Gestao.
REM
REM Use quando o leitor melhorar: os pedidos capturados ANTES da melhoria
REM ficaram so como bytes no disco, fora do faturamento. E pra isso que o
REM .bin cru e guardado.
REM
REM NAO imprime nada - nenhum papel de pedido antigo sai na cozinha.
cd /d "%~dp0"
call config.bat
node agent.js --reprocessar
pause
