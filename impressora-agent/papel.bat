@echo off
REM Confere SO o caminho de volta: manda uma comanda de mentira direto para a
REM impressora, sem depender de captura nenhuma e sem o agente estar rodando.
REM E o primeiro teste da instalacao.
REM
REM   Saiu papel  -> o repasse esta certo, pode criar as impressoras de captura.
REM   Nao saiu    -> o nome em IMPRESSORA_WINDOWS esta errado. Rode impressoras.bat.
cd /d "%~dp0"
call config.bat
node agent.js --papel
pause
