@echo off
REM Sobe a ponte de impressao e deixa rodando. Crie um atalho DESTE arquivo em
REM shell:startup (Win+R) para subir junto com o Windows.
REM A configuracao toda fica em config.bat.
cd /d "%~dp0"
call config.bat
node agent.js
pause
