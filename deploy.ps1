# Deploy frontend + backend -- Windows (PowerShell) port of deploy.sh.
# Uses ssh / scp / tar shipped with Win10/11 (no rsync needed).
# Usage:  powershell -ExecutionPolicy Bypass -File .\deploy.ps1 [server_ip]
# Requires: this machine can ssh into root@server (key auth, or it will prompt).
# NOTE: keep this file ASCII-only so Windows PowerShell 5.1 (reads .ps1 as the
# system codepage) never mangles it.

param([string]$Server = "121.43.194.213")

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

function Sync-Dir {
    # tar the local dir (with excludes) -> scp to server -> untar into target dir.
    param(
        [string]$LocalDir,
        [string]$RemoteDir,
        [string[]]$Exclude = @(),
        [switch]$Clean          # wipe remote dir before extract (frontend dist)
    )
    $tarName  = "epq-deploy-$([guid]::NewGuid().ToString('N')).tar"
    $localTar = Join-Path $env:TEMP $tarName
    $remoteTar = "/tmp/$tarName"

    $tarArgs = @("-C", $LocalDir)
    foreach ($e in $Exclude) { $tarArgs += "--exclude=$e" }
    $tarArgs += @("-cf", $localTar, ".")
    & tar @tarArgs
    if ($LASTEXITCODE -ne 0) { throw "tar pack failed: $LocalDir" }

    & scp $localTar "root@${Server}:${remoteTar}"
    if ($LASTEXITCODE -ne 0) { throw "scp upload failed: $LocalDir" }
    Remove-Item $localTar -Force

    $cleanCmd = if ($Clean) { "rm -rf ${RemoteDir}/*; " } else { "" }
    $remoteCmd = "mkdir -p ${RemoteDir}; ${cleanCmd}tar -C ${RemoteDir} -xf ${remoteTar}; rm -f ${remoteTar}"
    & ssh "root@${Server}" $remoteCmd
    if ($LASTEXITCODE -ne 0) { throw "remote extract failed: $RemoteDir" }
}

Write-Host "=== Deploying backend ===" -ForegroundColor Cyan
Sync-Dir -LocalDir (Join-Path $root "epq-tutor-backend") -RemoteDir "/opt/epq-tutor-backend" -Exclude ".venv", "__pycache__", "*.pyc", ".env", "*.db"
& ssh "root@${Server}" "systemctl restart epq-tutor; systemctl status epq-tutor --no-pager -l"

Write-Host "`n=== Deploying frontend ===" -ForegroundColor Cyan
Push-Location (Join-Path $root "tutoring-system")
try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }
} finally { Pop-Location }
Sync-Dir -LocalDir (Join-Path $root "tutoring-system\dist") -RemoteDir "/opt/epq-tutor/dist" -Clean

Write-Host "`n=== Deploying gantt-pro ===" -ForegroundColor Cyan
& ssh "root@${Server}" "mkdir -p /opt/gantt-pro"
& scp (Join-Path $root "gantt-chart-tool\gantt-pro.html") "root@${Server}:/opt/gantt-pro/gantt-pro.html"
if ($LASTEXITCODE -ne 0) { throw "gantt-pro upload failed" }

Write-Host "`n=== Done ===" -ForegroundColor Green
