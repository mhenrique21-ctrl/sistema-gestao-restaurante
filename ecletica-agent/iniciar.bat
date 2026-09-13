@echo off
REM Sobe a ponte e deixa rodando. Crie um atalho DESTE arquivo em
REM shell:startup (Win+R) para subir junto com o Windows.
REM A configuracao toda fica em config.bat.
cd /d "%~dp0"
call config.bat
if not exist node_modules ( echo Instalando dependencias... && call npm install )
node agent.js
pause
