#Requires -Version 5.1
<#
  Met Xchange à jour avec la dernière version publiée sur GitHub.
  Fait d'abord une sauvegarde, puis arrête Xchange, met à jour, recompile et redémarre.

  Terminal administrateur :
    powershell -ExecutionPolicy Bypass -File C:\Xchange\app\deploy\windows\mettre-a-jour.ps1
#>

. (Join-Path $PSScriptRoot 'commun.ps1')

Write-Host ''
Write-Host 'Mise à jour de Xchange' -ForegroundColor Cyan
Verifier-Admin
Verifier-Commande 'git' 'Git.Git'

Ecrire-Etape 'Sauvegarde avant mise à jour'
Push-Location (Join-Path $App 'backend')
try {
    Invoke-Natif 'La sauvegarde' { node --env-file="$FichierEnv" scripts\sauvegarde.js }
} finally {
    Pop-Location
}

Ecrire-Etape 'Récupération de la dernière version depuis GitHub'
$cheminGit = $App -replace '\\', '/'
Push-Location $App
try {
    $avant = (& git -c "safe.directory=$cheminGit" rev-parse --short HEAD).Trim()
    Invoke-Natif 'La récupération depuis GitHub' { git -c "safe.directory=$cheminGit" pull --ff-only }
    $apres = (& git -c "safe.directory=$cheminGit" rev-parse --short HEAD).Trim()
} finally {
    Pop-Location
}
if ($avant -eq $apres) {
    Ecrire-Ok "déjà à jour (version $apres)"
} else {
    Ecrire-Ok "version $avant remplacée par $apres"
}

Ecrire-Etape 'Arrêt de Xchange'
Arreter-Xchange
Ecrire-Ok 'fait'

Construire-Application

Ecrire-Etape 'Redémarrage'
Demarrer-Xchange
if (-not (Attendre-Xchange 90)) {
    Afficher-FinJournal
    Arreter-Sur-Erreur 'Xchange ne répond pas après la mise à jour. Envoie une capture de cette fenêtre.'
}
Ecrire-Ok "Xchange répond sur http://localhost:$Port"
Write-Host ''
Write-Host 'Mise à jour terminée.' -ForegroundColor Green
Write-Host ''
