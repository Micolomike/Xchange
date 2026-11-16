#Requires -Version 5.1
<#
  Installe Xchange sur ce PC, de façon isolée :
   - exécution sous « Service local », compte intégré à Windows sans mot de passe ni droits administrateur ;
   - C:\Xchange accessible seulement aux administrateurs et à ce compte ;
   - Xchange n'écoute que sur 127.0.0.1 (ce PC) : Internet n'y accède que par le tunnel Tailscale ;
   - démarrage automatique avec Windows ; sauvegarde quotidienne faite par Xchange (3 h 30 par défaut,
     réglable dans Administration > Sauvegardes).

  À lancer dans un Terminal administrateur, depuis C:\Xchange\app :
    powershell -ExecutionPolicy Bypass -File C:\Xchange\app\deploy\windows\installer.ps1
  Peut être relancé sans risque : la configuration et les données existantes sont conservées.
#>

. (Join-Path $PSScriptRoot 'commun.ps1')

Write-Host ''
Write-Host 'Installation de Xchange sur ce PC' -ForegroundColor Cyan
Write-Host '---------------------------------' -ForegroundColor Cyan

Verifier-Admin

Ecrire-Etape 'Vérification des outils'
Verifier-Commande 'node' 'OpenJS.NodeJS.LTS'
Verifier-Commande 'npm.cmd' 'OpenJS.NodeJS.LTS'
Verifier-Commande 'git' 'Git.Git'
$versionNode = ((& node -v) -replace '^v', '').Trim()
if ([int]($versionNode.Split('.')[0]) -lt 20) {
    Arreter-Sur-Erreur "Node.js $versionNode est trop ancien (20 minimum). Mets-le à jour : winget upgrade --id OpenJS.NodeJS.LTS -e"
}
Ecrire-Ok "Node.js $versionNode"
$dossierApp = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path.TrimEnd('\')
if ($dossierApp -ne $App) {
    Arreter-Sur-Erreur "Xchange doit être dans $App (il est actuellement dans $dossierApp). Suis l'étape 2 du guide."
}
Ecrire-Ok "Xchange trouvé dans $App"

Ecrire-Etape 'Arrêt d''une éventuelle version déjà installée'
Arreter-Xchange
Ecrire-Ok 'fait'

Construire-Application

Ecrire-Etape 'Dossiers de données, de sauvegarde et de journaux'
foreach ($dossier in @($Donnees, $Sauvegardes, $Journaux)) {
    New-Item -ItemType Directory -Path $dossier -Force | Out-Null
}
Ecrire-Ok "$Donnees, $Sauvegardes, $Journaux"

Ecrire-Etape 'Fichier de configuration'
if (Test-Path $FichierEnv) {
    Ecrire-Ok "configuration existante conservée ($FichierEnv)"
} else {
    $configuration = @(
        '# Configuration de Xchange sur ce PC.',
        '# Pour la modifier : Bloc-notes lancé en administrateur, puis relancer Xchange (voir le guide).',
        'NODE_ENV=production',
        "PORT=$Port",
        '# 127.0.0.1 = Xchange n''est joignable que depuis ce PC (et donc par le tunnel Tailscale).',
        'HOST=127.0.0.1',
        'TRUST_PROXY=1',
        'SERVE_FRONTEND=true',
        "FRONTEND_DIR=$App\frontend\dist",
        "DATA_DIR=$Donnees",
        "BACKUP_DIR=$Sauvegardes",
        'BACKUP_KEEP=14',
        '# false = seuls les administrateurs créent les comptes.',
        'ALLOW_REGISTRATION=true',
        "JWT_SECRET=$(Nouveau-Secret)"
    ) -join "`r`n"
    Ecrire-FichierTexte $FichierEnv ($configuration + "`r`n")
    Ecrire-Ok "créée : $FichierEnv (secret de session généré)"
}

Ecrire-Etape 'Compte d''exécution : « Service local » de Windows'
# Les versions précédentes de ce script créaient un compte « xchange » : on le retire.
if (Get-LocalUser -Name $AncienCompte -ErrorAction SilentlyContinue) {
    Arreter-Xchange
    Get-CimInstance Win32_UserProfile -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalPath -like "*\$AncienCompte" } | Remove-CimInstance -ErrorAction SilentlyContinue
    Remove-LocalUser -Name $AncienCompte
    Remove-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList' `
        -Name $AncienCompte -ErrorAction SilentlyContinue
    Ecrire-Ok "ancien compte « $AncienCompte » supprimé"
}
Ecrire-Ok 'compte intégré à Windows, sans mot de passe ni droits administrateur'

Ecrire-Etape "Droits d'accès sur $Racine"
# Seuls les administrateurs, le système et Service local y accèdent ; Service local
# ne peut écrire que dans les données, les sauvegardes et les journaux.
& icacls.exe $Racine /inheritance:r /grant:r "*${SidAdmins}:(OI)(CI)F" "*${SidSystem}:(OI)(CI)F" "*${SidServiceLocal}:(OI)(CI)RX" /Q | Out-Null
if ($LASTEXITCODE -ne 0) { Arreter-Sur-Erreur "impossible de régler les droits de $Racine." }
foreach ($dossier in @($Donnees, $Sauvegardes, $Journaux)) {
    & icacls.exe $dossier /grant:r "*${SidServiceLocal}:(OI)(CI)M" /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { Arreter-Sur-Erreur "impossible de régler les droits de $dossier." }
}
Ecrire-Ok 'accès réservé aux administrateurs et à Service local'

Ecrire-Etape 'Démarrage automatique'
$principal = New-ScheduledTaskPrincipal -UserId $SidServiceLocal -LogonType ServiceAccount -RunLevel Limited
$dossierBackend = Join-Path $App 'backend'

$lanceur = Join-Path $App 'deploy\windows\lancer.cmd'
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/d /c `"$lanceur`"" -WorkingDirectory $dossierBackend
$declencheur = New-ScheduledTaskTrigger -AtStartup
$parametres = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew `
    -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TacheApp -Action $action -Trigger $declencheur -Settings $parametres `
    -Principal $principal -Description 'Xchange : démarre avec Windows, sous Service local.' -Force | Out-Null
Ecrire-Ok "tâche « $TacheApp » : démarrage avec Windows, même sans session ouverte"

Retirer-AncienneTacheSauvegarde
Ecrire-Info 'sauvegarde quotidienne : faite par Xchange, à 3 h 30 par défaut (réglable dans Administration > Sauvegardes)'

Ecrire-Etape 'Démarrage de Xchange'
Demarrer-Xchange
if (-not (Attendre-Xchange 90)) {
    Afficher-FinJournal
    Arreter-Sur-Erreur 'Xchange ne répond pas. Envoie une capture de cette fenêtre (les lignes du journal ci-dessus aident).'
}
Ecrire-Ok "Xchange répond sur http://localhost:$Port"

$adresses = @(Adresses-Ecoute)
$horsLocal = @($adresses | Where-Object { $_ -ne '127.0.0.1' -and $_ -ne '::1' })
if ($horsLocal.Count -gt 0) {
    Arreter-Xchange
    Arreter-Sur-Erreur "Xchange écoutait sur $($horsLocal -join ', ') au lieu de 127.0.0.1 seulement : il a été arrêté par sécurité. Vérifie la ligne HOST=127.0.0.1 dans $FichierEnv."
}
Ecrire-Ok 'écoute uniquement sur 127.0.0.1 : rien n''est ouvert sur ton réseau'

Ecrire-Etape 'Test de la sauvegarde'
# Xchange sauvegarde au démarrage si la dernière sauvegarde prévue n'a pas été faite.
$limite = (Get-Date).AddSeconds(45)
$recente = $null
while ((Get-Date) -lt $limite -and -not $recente) {
    Start-Sleep -Seconds 3
    $recente = Get-ChildItem $Sauvegardes -Filter 'xchange_*.db' -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -gt (Get-Date).AddHours(-26) } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
if ($recente) {
    Ecrire-Ok "sauvegarde présente : $($recente.Name)"
} else {
    Ecrire-Alerte "aucune sauvegarde récente dans $Sauvegardes. Consulte $Journaux\xchange.log, ou lance « Sauvegarder maintenant » dans Administration > Sauvegardes."
}

Write-Host ''
Write-Host 'Installation terminée.' -ForegroundColor Green
Write-Host ''
Write-Host 'Étape suivante (guide, étape 3) :' -ForegroundColor Cyan
Write-Host "  1. Ouvre http://localhost:$Port dans ton navigateur."
Write-Host '  2. Clique sur « Créer un compte » : le premier compte créé devient administrateur.'
Write-Host '  3. Seulement ensuite, ouvre l''accès Internet (étape 4 du guide).'
Write-Host ''
