@echo off
REM Reenvia uma captura para a impressora. Use quando a impressora estava
REM desligada na hora do pedido e a comanda nao saiu.
REM   reimprimir.bat capturas\2026-09-14_18-22-05-431.bin
cd /d "%~dp0"
call config.bat
node agent.js --imprimir %1
pause
