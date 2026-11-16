#Requires -Version 5.1
<#
  Redémarre Xchange, par exemple après une modification de C:\Xchange\xchange.env.

  Terminal administrateur :
    powershell -ExecutionPolicy Bypass -File C:\Xchange\app\deploy\windows\redemarrer.ps1
#>

. (Join-Path $PSScriptRoot 'commun.ps1')

Write-Host ''
Write-Host 'Redémarrage de Xchange' -ForegroundColor Cyan
Verifier-Admin
if (-not (Get-ScheduledTask -TaskName $TacheApp -ErrorAction SilentlyContinue)) {
    Arreter-Sur-Erreur 'Xchange n''est pas installé. Suis l''étape 2 du guide.'
}

Ecrire-Etape 'Arrêt'
Arreter-Xchange
Ecrire-Ok 'fait'

Ecrire-Etape 'Démarrage'
Demarrer-Xchange
if (-not (Attendre-Xchange 90)) {
    Afficher-FinJournal
    Arreter-Sur-Erreur 'Xchange ne répond pas. Vérifie la dernière modification de C:\Xchange\xchange.env, ou envoie une capture de cette fenêtre.'
}
Ecrire-Ok "Xchange répond sur http://localhost:$Port"
Write-Host ''
