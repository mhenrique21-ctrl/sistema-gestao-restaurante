@echo off
REM Envia de uma vez um periodo inteiro que ja esta no disco - o historico
REM anterior a ponte existir, ou um periodo a refazer depois de corrigir o
REM mapa de formas de pagamento.
REM
REM E seguro repetir: o Gestao SUBSTITUI o registro de cada dia, nao soma.
cd /d "%~dp0"
call config.bat
if not exist node_modules ( echo Instalando dependencias... && call npm install )

set /p INI=Data inicial (AAAA-MM-DD): 
set /p FIM=Data final   (AAAA-MM-DD): 

echo.
echo === Primeiro uma SIMULACAO: nada e enviado, so mostra os numeros. ===
node agent.js --enviar %INI% %FIM% --simular

echo.
set /p OK=Os valores acima estao certos? Digite ENVIAR para gravar no Gestao: 
if /i not "%OK%"=="ENVIAR" ( echo Cancelado. Nada foi enviado. & pause & exit /b )

node agent.js --enviar %INI% %FIM%
pause
