@echo off
REM Mostra na tela o texto de uma captura ja guardada.
REM   ler.bat capturas\2026-09-14_18-22-05-431.bin
cd /d "%~dp0"
call config.bat
node agent.js --ler %1
pause
