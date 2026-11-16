#Requires -Version 5.1
<#
  Installe Xchange sur ce PC, de façon isolée :
   - un compte Windows dédié « xchange », sans droits administrateur et invisible à l'écran de connexion ;
   - C:\Xchange accessible seulement aux administrateurs et à ce compte ;
   - Xchange n'écoute que sur 127.0.0.1 (ce PC) : Internet n'y accède que par le tunnel Tailscale ;
   - démarrage automatique avec Windows, sauvegarde chaque nuit à 3 h 30.

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

Ecrire-Etape "Compte Windows dédié « $CompteService » (sans droits administrateur)"
$motDePasse = Nouveau-MotDePasse
$motDePasseSecurise = ConvertTo-SecureString $motDePasse -AsPlainText -Force
if (Get-LocalUser -Name $CompteService -ErrorAction SilentlyContinue) {
    Set-LocalUser -Name $CompteService -Password $motDePasseSecurise -PasswordNeverExpires $true
    Enable-LocalUser -Name $CompteService
    Ecrire-Ok 'compte existant, nouveau mot de passe aléatoire'
} else {
    New-LocalUser -Name $CompteService -Password $motDePasseSecurise -FullName 'Xchange (service)' `
        -Description 'Compte de service Xchange (sans droits admin)' `
        -PasswordNeverExpires -UserMayNotChangePassword -AccountNeverExpires | Out-Null
    Ecrire-Ok 'compte créé'
}
try { Add-LocalGroupMember -Group (Get-LocalGroup -SID $SidUtilisateurs) -Member $CompteService } catch { }
try { Remove-LocalGroupMember -Group (Get-LocalGroup -SID $SidAdmins) -Member $CompteService } catch { }
$cleMasquage = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList'
New-Item -Path $cleMasquage -Force | Out-Null
New-ItemProperty -Path $cleMasquage -Name $CompteService -Value 0 -PropertyType DWord -Force | Out-Null
Ecrire-Ok 'membre du seul groupe Utilisateurs, masqué de l''écran de connexion'

Ecrire-Etape "Droits d'accès sur $Racine"
# Seuls les administrateurs, le système et le compte de service y accèdent ; le compte de service
# ne peut écrire que dans les données, les sauvegardes et les journaux.
& icacls.exe $Racine /inheritance:r /grant:r "*${SidAdmins}:(OI)(CI)F" "*${SidSystem}:(OI)(CI)F" "${env:COMPUTERNAME}\${CompteService}:(OI)(CI)RX" /Q | Out-Null
if ($LASTEXITCODE -ne 0) { Arreter-Sur-Erreur "impossible de régler les droits de $Racine." }
foreach ($dossier in @($Donnees, $Sauvegardes, $Journaux)) {
    & icacls.exe $dossier /grant:r "${env:COMPUTERNAME}\${CompteService}:(OI)(CI)M" /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { Arreter-Sur-Erreur "impossible de régler les droits de $dossier." }
}
Ecrire-Ok 'accès réservé aux administrateurs et au compte de service'

Ecrire-Etape 'Démarrage automatique et sauvegarde quotidienne'
$utilisateurTache = "$env:COMPUTERNAME\$CompteService"
$dossierBackend = Join-Path $App 'backend'

$lanceur = Join-Path $App 'deploy\windows\lancer.cmd'
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/d /c `"$lanceur`"" -WorkingDirectory $dossierBackend
$declencheur = New-ScheduledTaskTrigger -AtStartup
$parametres = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew `
    -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TacheApp -Action $action -Trigger $declencheur -Settings $parametres `
    -User $utilisateurTache -Password $motDePasse -RunLevel Limited `
    -Description 'Xchange : démarre avec Windows, sous le compte xchange.' -Force | Out-Null
Ecrire-Ok "tâche « $TacheApp » : démarrage avec Windows, même sans session ouverte"

$sauvegarde = Join-Path $App 'deploy\windows\sauvegarder.cmd'
$actionSauvegarde = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/d /c `"$sauvegarde`"" -WorkingDirectory $dossierBackend
$declencheurSauvegarde = New-ScheduledTaskTrigger -Daily -At '03:30'
$parametresSauvegarde = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName $TacheSauvegarde -Action $actionSauvegarde -Trigger $declencheurSauvegarde `
    -Settings $parametresSauvegarde -User $utilisateurTache -Password $motDePasse -RunLevel Limited `
    -Description 'Xchange : sauvegarde de la base et des fichiers joints.' -Force | Out-Null
Ecrire-Ok "tâche « $TacheSauvegarde » : chaque nuit à 3 h 30 (ou au démarrage suivant si le PC était éteint)"

# Le mot de passe n'est plus utile : il n'est stocké que par le Planificateur de tâches.
$motDePasse = $null
$motDePasseSecurise = $null

Ecrire-Etape 'Démarrage de Xchange'
Demarrer-Xchange
if (-not (Attendre-Xchange 90)) {
    Afficher-FinJournal
    Arreter-Sur-Erreur 'Xchange ne répond pas. Envoie une capture de cette fenêtre (les lignes du journal ci-dessus aident).'
}
Ecrire-Ok "Xchange répond sur http://localhost:$Port"

$adresses = Adresses-Ecoute
$horsLocal = @($adresses | Where-Object { $_ -ne '127.0.0.1' -and $_ -ne '::1' })
if ($horsLocal.Count -gt 0) {
    Arreter-Xchange
    Arreter-Sur-Erreur "Xchange écoutait sur $($horsLocal -join ', ') au lieu de 127.0.0.1 seulement : il a été arrêté par sécurité. Vérifie la ligne HOST=127.0.0.1 dans $FichierEnv."
}
Ecrire-Ok 'écoute uniquement sur 127.0.0.1 : rien n''est ouvert sur ton réseau'

Ecrire-Etape 'Test de la sauvegarde'
Start-ScheduledTask -TaskName $TacheSauvegarde
$limite = (Get-Date).AddSeconds(60)
$sauvegardeFaite = $null
while ((Get-Date) -lt $limite -and -not $sauvegardeFaite) {
    Start-Sleep -Seconds 3
    $sauvegardeFaite = Get-ChildItem $Sauvegardes -Filter 'xchange_*.db' -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -gt (Get-Date).AddMinutes(-3) } | Select-Object -First 1
}
if ($sauvegardeFaite) {
    Ecrire-Ok "première sauvegarde créée : $($sauvegardeFaite.Name)"
} else {
    Ecrire-Alerte "la sauvegarde de test n'est pas apparue dans $Sauvegardes. Consulte $Journaux\sauvegardes.log."
}

Write-Host ''
Write-Host 'Installation terminée.' -ForegroundColor Green
Write-Host ''
Write-Host 'Étape suivante (guide, étape 3) :' -ForegroundColor Cyan
Write-Host "  1. Ouvre http://localhost:$Port dans ton navigateur."
Write-Host '  2. Clique sur « Créer un compte » : le premier compte créé devient administrateur.'
Write-Host '  3. Seulement ensuite, ouvre l''accès Internet (étape 4 du guide).'
Write-Host ''
