#Requires -Version 5.1
<#
  Affiche l'état de Xchange : démarré ou non, accès Internet, dernière sauvegarde, journal.
  Ne modifie rien.

  Terminal administrateur :
    powershell -ExecutionPolicy Bypass -File C:\Xchange\app\deploy\windows\etat.ps1
#>

. (Join-Path $PSScriptRoot 'commun.ps1')

Write-Host ''
Write-Host 'État de Xchange' -ForegroundColor Cyan
Verifier-Admin

Ecrire-Etape 'Application'
$tache = Get-ScheduledTask -TaskName $TacheApp -ErrorAction SilentlyContinue
if (-not $tache) {
    Ecrire-Alerte 'Xchange n''est pas installé (tâche planifiée absente). Suis l''étape 2 du guide.'
} else {
    $infos = Get-ScheduledTaskInfo -TaskName $TacheApp
    Ecrire-Info "Tâche planifiée : $($tache.State) (dernier lancement : $($infos.LastRunTime))"
    if (Tester-Xchange) {
        Ecrire-Ok "Xchange répond sur http://localhost:$Port"
    } else {
        Ecrire-Alerte 'Xchange ne répond pas. Essaie : Start-ScheduledTask -TaskName Xchange   puis relance ce script.'
    }
    $adresses = @(Adresses-Ecoute)
    if ($adresses.Count -eq 0) {
        Ecrire-Info 'Aucune écoute sur le port 4000.'
    } elseif (@($adresses | Where-Object { $_ -ne '127.0.0.1' -and $_ -ne '::1' }).Count -gt 0) {
        Ecrire-Alerte "écoute sur $($adresses -join ', ') : Xchange est joignable depuis ton réseau local. Vérifie HOST=127.0.0.1 dans $FichierEnv."
    } else {
        Ecrire-Ok 'écoute uniquement sur 127.0.0.1'
    }
}

Ecrire-Etape 'Accès Internet (Tailscale Funnel)'
if (Get-Command tailscale -ErrorAction SilentlyContinue) {
    # Tailscale écrit parfois sur la sortie d'erreur : on ne veut pas que ça arrête le script.
    $ancien = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $etatFunnel = (& tailscale funnel status 2>&1 | Out-String).Trim()
    $ErrorActionPreference = $ancien
    if ($etatFunnel) {
        $etatFunnel -split "`r?`n" | ForEach-Object { Ecrire-Info $_ }
    } else {
        Ecrire-Info 'Aucun accès Internet configuré.'
    }
} else {
    Ecrire-Info 'Tailscale n''est pas installé : Xchange n''est accessible que depuis ce PC.'
}

Ecrire-Etape 'Sauvegardes'
$derniere = Get-ChildItem $Sauvegardes -Filter 'xchange_*.db' -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1
if (-not $derniere) {
    Ecrire-Alerte "aucune sauvegarde dans $Sauvegardes."
} else {
    $age = (Get-Date) - $derniere.LastWriteTime
    $texte = "dernière : $($derniere.Name) ($([int]$age.TotalHours) h)"
    if ($age.TotalHours -gt 48) { Ecrire-Alerte "$texte, plus de 2 jours !" } else { Ecrire-Ok $texte }
    $nombre = @(Get-ChildItem $Sauvegardes -Filter 'xchange_*.db').Count
    Ecrire-Info "$nombre sauvegarde(s) conservée(s) dans $Sauvegardes"
}

Afficher-FinJournal 15
Write-Host ''
