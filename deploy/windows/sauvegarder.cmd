@echo off
rem Sauvegarde de Xchange (base de donnees et fichiers joints).
rem Utilise par la tache planifiee "Xchange - sauvegarde", sous le compte Service local de Windows.
setlocal
set "RACINE=%~dp0..\..\.."
cd /d "%~dp0..\..\backend"
node --env-file="%RACINE%\xchange.env" scripts\sauvegarde.js >> "%RACINE%\journaux\sauvegardes.log" 2>&1
exit /b %errorlevel%
