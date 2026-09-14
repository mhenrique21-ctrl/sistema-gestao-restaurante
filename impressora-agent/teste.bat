@echo off
REM Manda uma comanda de MENTIRA para o agente, sem depender de um pedido real.
REM Deixe o iniciar.bat aberto numa janela e rode este noutra.
REM   - saiu papel na impressora   -> o repasse esta certo
REM   - apareceu arquivo em capturas\ -> a captura esta certa
cd /d "%~dp0"
call config.bat
node agent.js --teste
pause
