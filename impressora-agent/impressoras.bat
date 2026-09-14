@echo off
REM Pergunta ao WINDOWS quais impressoras existem e como cada uma esta
REM compartilhada. O nome que vai em IMPRESSORA_WINDOWS e a coluna ShareName.
cd /d "%~dp0"
call config.bat
node agent.js --impressoras
pause
