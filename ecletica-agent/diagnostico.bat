@echo off
REM Responde "por que nao apareceu venda nenhuma": diz se a pasta existe,
REM quantos XML tem, quais datas achou e por que cada arquivo foi descartado.
REM Nao envia nada pro servidor — so le e mostra.
set ECLETICA_XML=C:\Wineclt\ArquivosSistema\XmlVenda;C:\Wineclt\ArquivosSistema\XmlVenda2
cd /d "%~dp0"
if not exist node_modules ( echo Instalando dependencias... && call npm install )
node agent.js --diagnostico %1
pause
