#Requires -Version 5.1
<#
  Désinstalle Xchange de ce PC : coupe l'accès Internet et supprime les tâches planifiées.
  Les données sont conservées, sauf avec -SupprimerDonnees.

  Terminal administrateur :
    powershell -ExecutionPolicy Bypass -File C:\Xchange\app\deploy\windows\desinstaller.ps1
#>
param([switch]$SupprimerDonnees)

. (Join-Path $PSScriptRoot 'commun.ps1')

Write-Host ''
Write-Host 'Désinstallation de Xchange' -ForegroundColor Cyan
Verifier-Admin
if ($SupprimerDonnees) {
    Write-Host "Tout $Racine sera supprimé, données et sauvegardes comprises." -ForegroundColor Yellow
} else {
    Write-Host "Les données et sauvegardes restent dans $Racine." -ForegroundColor Yellow
}
if ((Read-Host 'Tape OUI pour confirmer') -ne 'OUI') { Write-Host 'Annulé, rien n''a changé.'; exit 0 }

Ecrire-Etape 'Coupure de l''accès Internet'
if (Get-Command tailscale -ErrorAction SilentlyContinue) {
    $ancien = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & tailscale funnel reset 2>&1 | Out-Null
    $ErrorActionPreference = $ancien
    Ecrire-Ok 'configuration Tailscale Funnel effacée'
} else {
    Ecrire-Info 'Tailscale absent, rien à faire.'
}

Ecrire-Etape 'Arrêt et suppression des tâches planifiées'
Arreter-Xchange
foreach ($nom in @($TacheApp, $TacheSauvegarde)) {
    Unregister-ScheduledTask -TaskName $nom -Confirm:$false -ErrorAction SilentlyContinue
}
Ecrire-Ok 'fait'

if ($SupprimerDonnees) {
    Ecrire-Etape "Suppression de $Racine"
    Set-Location $env:SystemDrive\
    Remove-Item $Racine -Recurse -Force
    Ecrire-Ok 'fait'
}

Write-Host ''
Write-Host 'Xchange est désinstallé.' -ForegroundColor Green
Write-Host ''
