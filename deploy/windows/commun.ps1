# Réglages et fonctions communs aux scripts Xchange pour Windows.
# Ce fichier est chargé par les autres scripts : ne pas le lancer directement.

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

$Racine          = 'C:\Xchange'
$App             = Join-Path $Racine 'app'
$Donnees         = Join-Path $Racine 'donnees'
$Sauvegardes     = Join-Path $Racine 'sauvegardes'
$Journaux        = Join-Path $Racine 'journaux'
$FichierEnv      = Join-Path $Racine 'xchange.env'
# Xchange tourne sous « Service local », compte intégré à Windows prévu pour les services :
# aucun mot de passe, aucun droit d'administrateur, aucun accès aux dossiers personnels.
$SidServiceLocal = 'S-1-5-19'
$AncienCompte    = 'xchange'
$Port            = 4000
$TacheApp        = 'Xchange'
$TacheSauvegarde = 'Xchange - sauvegarde'

# Groupes Windows désignés par leur identifiant, valable quelle que soit la langue du système.
$SidAdmins       = 'S-1-5-32-544'
$SidSystem       = 'S-1-5-18'
$SidUtilisateurs = 'S-1-5-32-545'

function Ecrire-Etape([string]$Texte) {
    Write-Host ''
    Write-Host "==> $Texte" -ForegroundColor Cyan
}

function Ecrire-Ok([string]$Texte) {
    Write-Host "    OK : $Texte" -ForegroundColor Green
}

function Ecrire-Info([string]$Texte) {
    Write-Host "    $Texte"
}

function Ecrire-Alerte([string]$Texte) {
    Write-Host "    ATTENTION : $Texte" -ForegroundColor Yellow
}

function Arreter-Sur-Erreur([string]$Texte) {
    Write-Host ''
    Write-Host "ERREUR : $Texte" -ForegroundColor Red
    Write-Host 'Rien n''est cassé : corrige le point ci-dessus puis relance la même commande.' -ForegroundColor Red
    exit 1
}

function Verifier-Admin {
    $identite = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identite)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Arreter-Sur-Erreur 'ce script doit être lancé dans un Terminal ouvert en administrateur (clic droit sur le bouton Démarrer, puis « Terminal (administrateur) »).'
    }
}

function Verifier-Commande([string]$Nom, [string]$IdWinget) {
    if (-not (Get-Command $Nom -ErrorAction SilentlyContinue)) {
        Arreter-Sur-Erreur "$Nom est introuvable. Installe-le avec la commande : winget install --id $IdWinget -e   puis ferme et rouvre le Terminal (en administrateur)."
    }
}

# Lance un programme externe et s'arrête proprement s'il échoue.
function Invoke-Natif([string]$Description, [scriptblock]$Commande) {
    & $Commande
    if ($LASTEXITCODE -ne 0) {
        Arreter-Sur-Erreur "$Description a échoué (code $LASTEXITCODE). Les messages juste au-dessus indiquent pourquoi."
    }
}

function Nouveau-Secret([int]$Octets = 48) {
    $octetsAleatoires = New-Object byte[] $Octets
    $generateur = [Security.Cryptography.RandomNumberGenerator]::Create()
    $generateur.GetBytes($octetsAleatoires)
    $generateur.Dispose()
    return ([BitConverter]::ToString($octetsAleatoires) -replace '-', '').ToLower()
}

# Mot de passe du compte de service : long, aléatoire, connu de personne (il n'est jamais affiché).
function Nouveau-MotDePasse {
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#%+-=?@_'
    $octetsAleatoires = New-Object byte[] 40
    $generateur = [Security.Cryptography.RandomNumberGenerator]::Create()
    $generateur.GetBytes($octetsAleatoires)
    $generateur.Dispose()
    $suite = -join ($octetsAleatoires | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
    return "Xc9!$suite"
}

function Ecrire-FichierTexte([string]$Chemin, [string]$Contenu) {
    # UTF-8 sans BOM : lisible par Node.js.
    [IO.File]::WriteAllText($Chemin, $Contenu, (New-Object Text.UTF8Encoding $false))
}

function Construire-Application {
    Ecrire-Etape 'Installation des composants et compilation du site (2 à 5 minutes)'
    Push-Location (Join-Path $App 'backend')
    try {
        Invoke-Natif 'L''installation des composants de l''API' { npm.cmd ci --omit=dev --no-audit --no-fund }
        # Les versions récentes de npm ne lancent plus les scripts d'installation : le module
        # SQLite (compilé pour Windows) n'est alors pas téléchargé. On le récupère explicitement.
        & node scripts\verifier-sqlite.js
        if ($LASTEXITCODE -ne 0) {
            Push-Location 'node_modules\sqlite3'
            try {
                Invoke-Natif 'Le téléchargement du module SQLite' { node ..\prebuild-install\bin.js -r napi }
            } finally {
                Pop-Location
            }
            & node scripts\verifier-sqlite.js
            if ($LASTEXITCODE -ne 0) { Arreter-Sur-Erreur 'le module SQLite reste inutilisable après téléchargement.' }
        }
        Ecrire-Ok 'module SQLite opérationnel'
    } finally {
        Pop-Location
    }
    Push-Location (Join-Path $App 'frontend')
    try {
        Invoke-Natif 'L''installation des composants du site' { npm.cmd ci --no-audit --no-fund }
        Invoke-Natif 'La compilation du site' { npm.cmd run build:pc }
    } finally {
        Pop-Location
    }
    Ecrire-Ok 'application prête'
}

function Arreter-Xchange {
    if (Get-ScheduledTask -TaskName $TacheApp -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $TacheApp -ErrorAction SilentlyContinue
    }
    # Le lanceur relance Node en boucle : on arrête aussi les processus de Xchange encore présents.
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe' OR Name = 'cmd.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and ($_.CommandLine -like '*xchange.env*' -or $_.CommandLine -like '*\Xchange\app\deploy\windows\*') } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
}

function Demarrer-Xchange {
    Start-ScheduledTask -TaskName $TacheApp
}

function Tester-Xchange {
    try {
        $reponse = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 3
        return ($reponse.status -eq 'ok')
    } catch {
        return $false
    }
}

function Attendre-Xchange([int]$Secondes = 60) {
    $limite = (Get-Date).AddSeconds($Secondes)
    while ((Get-Date) -lt $limite) {
        if (Tester-Xchange) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

# Adresses sur lesquelles Xchange écoute : seule 127.0.0.1 (ce PC uniquement) est attendue.
function Adresses-Ecoute {
    $connexions = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $connexions) { return @() }
    return @($connexions | Select-Object -ExpandProperty LocalAddress -Unique)
}

function Afficher-DiagnosticTache {
    $infos = Get-ScheduledTaskInfo -TaskName $TacheApp -ErrorAction SilentlyContinue
    if ($infos) {
        $etat = (Get-ScheduledTask -TaskName $TacheApp).State
        Write-Host ''
        Write-Host "Tâche « $TacheApp » : état $etat, dernier lancement $($infos.LastRunTime), code $($infos.LastTaskResult)" -ForegroundColor Yellow
    }
    if (-not (Test-Path (Join-Path $Journaux 'xchange.log'))) {
        Write-Host "Aucun journal : la tâche n'a pas pu lancer Xchange." -ForegroundColor Yellow
    }
}

function Afficher-FinJournal([int]$Lignes = 20) {
    Afficher-DiagnosticTache
    $journal = Join-Path $Journaux 'xchange.log'
    if (Test-Path $journal) {
        Write-Host ''
        Write-Host "Dernières lignes du journal ($journal) :" -ForegroundColor Yellow
        Get-Content $journal -Tail $Lignes | ForEach-Object { Write-Host "    $_" }
    }
}
