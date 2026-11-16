#Requires -Version 5.1
<#
  Autorise Xchange (compte « Service local ») à écrire dans un dossier, par exemple pour la copie
  automatique des sauvegardes sur un autre disque. Crée le dossier s'il n'existe pas.
  Les droits ne sont ajoutés qu'à ce dossier et à son contenu, rien d'autre sur le disque.

  Terminal administrateur :
    powershell -ExecutionPolicy Bypass -File C:\Xchange\app\deploy\windows\autoriser-dossier.ps1 -Dossier "D:\Xchange-sauvegardes"
#>
param([Parameter(Mandatory = $true)][string]$Dossier)

. (Join-Path $PSScriptRoot 'commun.ps1')

Write-Host ''
Write-Host "Autorisation d'un dossier pour Xchange" -ForegroundColor Cyan
Verifier-Admin

if (-not [System.IO.Path]::IsPathRooted($Dossier)) {
    Arreter-Sur-Erreur 'indique un chemin complet, par exemple D:\Xchange-sauvegardes.'
}
$complet = [System.IO.Path]::GetFullPath($Dossier).TrimEnd('\')
if ($complet.Length -le 3) {
    Arreter-Sur-Erreur 'choisis un dossier, pas la racine d''un disque (par exemple D:\Xchange-sauvegardes).'
}
if ($complet.StartsWith($Racine, [System.StringComparison]::OrdinalIgnoreCase)) {
    Arreter-Sur-Erreur "ce dossier est dans $Racine : choisis un emplacement sur un autre disque."
}

Ecrire-Etape 'Dossier'
if (-not (Test-Path -LiteralPath $complet)) {
    New-Item -ItemType Directory -Path $complet -Force | Out-Null
    Ecrire-Ok "créé : $complet"
} else {
    Ecrire-Ok "existe déjà : $complet"
}

Ecrire-Etape 'Droits de Service local'
# (OI)(CI)M : modification du dossier et de tout ce qu'il contient.
& icacls $complet /grant "*$($SidServiceLocal):(OI)(CI)M" | Out-Null
if ($LASTEXITCODE -ne 0) { Arreter-Sur-Erreur 'icacls a échoué : envoie une capture de cette fenêtre.' }
Ecrire-Ok 'Service local peut écrire dans ce dossier'

Write-Host ''
Write-Host 'Terminé. Dans Xchange : Administration > Sauvegardes, indique ce dossier puis clique sur « Tester l''écriture ».' -ForegroundColor Green
Write-Host ''
