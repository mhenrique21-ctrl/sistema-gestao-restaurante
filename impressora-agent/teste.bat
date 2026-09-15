@echo off
REM Manda uma comanda de MENTIRA para o agente, sem depender de um pedido real.
REM Deixe o iniciar.bat aberto numa janela e rode este noutra.
REM   - saiu papel na impressora      -> o repasse esta certo
REM   - apareceu arquivo em capturas\ -> a captura esta certa
REM   - o nome termina em _99food / _ifood -> o rotulo esta certo
REM
REM Sem argumento testa TODAS as capturas configuradas. Para testar so uma:
REM   teste.bat ifood
cd /d "%~dp0"
call config.bat
node agent.js --teste %1
pause
