# win_deploy.ps1 — Windows equivalent of deploy.sh
# Usage: .\win_deploy.ps1 [server_ip]
param([string]$Server = "121.43.194.213")

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host $msg -ForegroundColor Green }
function Err($msg)  { Write-Host $msg -ForegroundColor Red }

# ── Backend ──────────────────────────────────────────────────────────────────

Step "Deploying backend"

$BackendSrc = "$Root\epq-tutor-backend"
$BackendDst = "root@${Server}:/opt/epq-tutor-backend/"

# Upload app/ directory (core code)
Write-Host "Uploading app/..."
scp -r "$BackendSrc\app" $BackendDst
if ($LASTEXITCODE -ne 0) { Err "scp app/ failed"; exit 1 }

# Upload top-level Python scripts and config files
Write-Host "Uploading scripts and config..."
$files = @(
    "requirements.txt",
    "alembic.ini",
    "create_tables.py",
    "init_tutor.py",
    "migrate_from_local.py",
    "migrate_from_github.py",
    "migrate_to_sqlite.py"
)
foreach ($f in $files) {
    $path = "$BackendSrc\$f"
    if (Test-Path $path) {
        scp "$path" $BackendDst
        if ($LASTEXITCODE -ne 0) { Err "scp $f failed"; exit 1 }
    }
}

# Restart backend service
Write-Host "Restarting epq-tutor service..."
ssh "root@$Server" "systemctl restart epq-tutor && systemctl status epq-tutor --no-pager -l"
if ($LASTEXITCODE -ne 0) { Err "Service restart failed"; exit 1 }
Ok "Backend deployed."

# ── Frontend ─────────────────────────────────────────────────────────────────

Step "Building frontend"

$FrontendDir = "$Root\tutoring-system"
Push-Location $FrontendDir

if (-not (Test-Path "node_modules")) {
    Write-Host "node_modules not found, running npm install..."
    npm install
    if ($LASTEXITCODE -ne 0) { Err "npm install failed"; Pop-Location; exit 1 }
}

.\node_modules\.bin\vite build
if ($LASTEXITCODE -ne 0) { Err "vite build failed"; Pop-Location; exit 1 }
Pop-Location
Ok "Frontend built."

Step "Uploading frontend dist"

$DistSrc = "$FrontendDir\dist\"
$DistDst  = "root@${Server}:/opt/epq-tutor/dist/"

scp -r "$DistSrc*" $DistDst
if ($LASTEXITCODE -ne 0) {
    # scp glob doesn't expand on Windows — fall back to uploading the dist folder contents individually
    Get-ChildItem "$DistSrc" | ForEach-Object {
        scp -r $_.FullName $DistDst
        if ($LASTEXITCODE -ne 0) { Err "scp $($_.Name) failed"; exit 1 }
    }
}
Ok "Frontend uploaded."

Step "Done"
Write-Host "Deployed to $Server. Hard-refresh the browser (Ctrl+Shift+R)." -ForegroundColor Green
