@echo off
rem Lance Xchange et le relance automatiquement s'il s'arrete.
rem Utilise par la tache planifiee "Xchange", sous le compte de service xchange.
setlocal
set "RACINE=%~dp0..\..\.."
set "JOURNAL=%RACINE%\journaux\xchange.log"
cd /d "%~dp0..\..\backend"

rem Garde un journal de taille raisonnable (5 Mo).
for %%F in ("%JOURNAL%") do if exist "%%~fF" if %%~zF GTR 5000000 move /y "%%~fF" "%%~dpnF.ancien.log" > nul

:boucle
echo [%date% %time%] Demarrage de Xchange>> "%JOURNAL%"
node --env-file="%RACINE%\xchange.env" index.js >> "%JOURNAL%" 2>&1
echo [%date% %time%] Xchange s'est arrete (code %errorlevel%), relance dans 10 secondes>> "%JOURNAL%"
ping -n 11 127.0.0.1 > nul
goto boucle
