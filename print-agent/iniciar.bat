@echo off
title Agente de Impressao - Confraria Cafe
cd /d C:\print-agent

REM ============================================================
REM  COLE AQUI O SEGREDO DO AGENTE (PRINT_AGENT_SECRET do .env
REM  do servidor). Ele nao expira — o agente troca por um token
REM  novo a cada conexao, entao a impressao nunca mais para
REM  sozinha por token vencido.
REM ============================================================
set PRINT_AGENT_SECRET=COLE_O_SEGREDO_AQUI

REM Nome EXATO de cada impressora como aparece no Windows.
REM Conferir com: Get-Printer   (ou botao Detectar no admin)
set PRINTER_CAIXA=ELGIN i8
set PRINTER_COZINHA=ELGIN i8
set PRINTER_BALCAO=ELGIN i8

if "%PRINT_AGENT_SECRET%"=="COLE_O_SEGREDO_AQUI" (
  echo.
  echo  [!] Falta configurar o segredo neste arquivo.
  echo      Abra iniciar.bat com o Bloco de Notas e cole o
  echo      PRINT_AGENT_SECRET na linha indicada.
  echo.
  pause
  exit /b 1
)

echo Iniciando agente de impressao...
node agent.js

REM Se cair, avisa em vez de fechar a janela sem explicacao.
echo.
echo  [!] O agente parou. Leia a mensagem acima.
pause
