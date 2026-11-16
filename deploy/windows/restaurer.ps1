#Requires -Version 5.1
<#
  Remet Xchange dans l'état d'une sauvegarde : choisie dans une liste (sauvegardes de la nuit),
  ou donnée par son chemin avec -Fichier (archive .zip téléchargée depuis Administration, ou .db).
  Les données actuelles sont d'abord copiées dans C:\Xchange\sauvegardes (avant-restauration_...).

  Terminal administrateur :
    powershell -ExecutionPolicy Bypass -File C:\Xchange\app\deploy\windows\restaurer.ps1
    powershell -ExecutionPolicy Bypass -File C:\Xchange\app\deploy\windows\restaurer.ps1 -Fichier "E:\Xchange-sauvegardes\xchange_....zip"
#>
param([string]$Fichier)

. (Join-Path $PSScriptRoot 'commun.ps1')

Write-Host ''
Write-Host 'Restauration d''une sauvegarde de Xchange' -ForegroundColor Cyan
Verifier-Admin

$temporaire = $null
if ($Fichier) {
    if (-not (Test-Path -LiteralPath $Fichier)) { Arreter-Sur-Erreur "fichier introuvable : $Fichier" }
    $element = Get-Item -LiteralPath $Fichier
    $dateSauvegarde = $element.LastWriteTime
    if ($element.Extension -eq '.zip') {
        $temporaire = Join-Path $env:TEMP ("xchange-restauration-" + (Get-Date -Format 'yyyyMMddHHmmss'))
        Expand-Archive -LiteralPath $element.FullName -DestinationPath $temporaire -Force
        $baseSource = Join-Path $temporaire 'xchange.db'
        $fichiersSource = Join-Path $temporaire 'fichiers'
        if (-not (Test-Path $baseSource)) { Arreter-Sur-Erreur "cette archive ne contient pas de sauvegarde Xchange (xchange.db absent)." }
    } elseif ($element.Extension -eq '.db') {
        $baseSource = $element.FullName
        $fichiersSource = Join-Path $Sauvegardes 'fichiers'
    } else {
        Arreter-Sur-Erreur 'le fichier doit être une archive .zip ou une base .db de Xchange.'
    }
    $libelle = $element.Name
} else {
    $liste = @(Get-ChildItem $Sauvegardes -Filter 'xchange_*.db' -ErrorAction SilentlyContinue | Sort-Object Name -Descending)
    if ($liste.Count -eq 0) {
        Arreter-Sur-Erreur "aucune sauvegarde trouvée dans $Sauvegardes."
    }
    Write-Host ''
    for ($i = 0; $i -lt $liste.Count; $i++) {
        Write-Host ("  {0,2}. {1}   ({2:N0} Ko)" -f ($i + 1), $liste[$i].LastWriteTime.ToString('dddd d MMMM yyyy, HH:mm'), ($liste[$i].Length / 1KB))
    }
    Write-Host ''
    $saisie = Read-Host 'Numéro de la sauvegarde à restaurer (Entrée seule pour annuler)'
    if (-not $saisie) { Write-Host 'Annulé, rien n''a changé.'; exit 0 }
    $numero = 0
    if (-not [int]::TryParse($saisie, [ref]$numero) -or $numero -lt 1 -or $numero -gt $liste.Count) {
        Arreter-Sur-Erreur "« $saisie » n'est pas un numéro de la liste."
    }
    $choix = $liste[$numero - 1]
    $baseSource = $choix.FullName
    $fichiersSource = Join-Path $Sauvegardes 'fichiers'
    $dateSauvegarde = $choix.LastWriteTime
    $libelle = $choix.Name
}

Write-Host ''
Write-Host "Les tickets, comptes et commentaires vont revenir à l'état du $($dateSauvegarde.ToString('d MMMM yyyy à HH:mm'))." -ForegroundColor Yellow
Write-Host 'Ce qui a été fait depuis sera remplacé (une copie de l''état actuel est gardée).' -ForegroundColor Yellow
if ((Read-Host 'Tape OUI pour confirmer') -ne 'OUI') { Write-Host 'Annulé, rien n''a changé.'; exit 0 }

Ecrire-Etape 'Arrêt de Xchange'
Arreter-Xchange
Ecrire-Ok 'fait'

Ecrire-Etape 'Copie de sécurité de l''état actuel'
$base = Join-Path $Donnees 'tickets.db'
$horodatage = Get-Date -Format 'yyyy-MM-dd_HHmmss'
if (Test-Path $base) {
    $copie = Join-Path $Sauvegardes "avant-restauration_$horodatage.db"
    Copy-Item $base $copie
    if (Test-Path "$base-wal") { Copy-Item "$base-wal" "$copie-wal" }
    Ecrire-Ok $copie
}

Ecrire-Etape 'Restauration'
Remove-Item "$base-wal", "$base-shm" -Force -ErrorAction SilentlyContinue
Copy-Item -LiteralPath $baseSource $base -Force
$fichiersSauvegardes = $fichiersSource
$fichiersActuels = Join-Path $Donnees 'uploads'
$restaures = 0
if (Test-Path $fichiersSauvegardes) {
    New-Item -ItemType Directory -Path $fichiersActuels -Force | Out-Null
    Get-ChildItem $fichiersSauvegardes -File | Where-Object { -not (Test-Path (Join-Path $fichiersActuels $_.Name)) } | ForEach-Object {
        Copy-Item $_.FullName $fichiersActuels
        $restaures++
    }
}
if ($temporaire) { Remove-Item $temporaire -Recurse -Force -ErrorAction SilentlyContinue }
Ecrire-Ok "base restaurée depuis $libelle, $restaures fichier(s) joint(s) remis en place"

Ecrire-Etape 'Redémarrage'
Demarrer-Xchange
if (-not (Attendre-Xchange 90)) {
    Afficher-FinJournal
    Arreter-Sur-Erreur 'Xchange ne répond pas après la restauration. Envoie une capture de cette fenêtre.'
}
Ecrire-Ok "Xchange répond sur http://localhost:$Port"
Write-Host ''
Write-Host 'Restauration terminée.' -ForegroundColor Green
Write-Host ''
