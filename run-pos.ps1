$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend'
$env:FRONTEND_DIR = Join-Path $root 'frontend'
$env:DATA_DIR = Join-Path $root 'data'
if (-not $env:PORT) { $env:PORT = '8787' }
Write-Host "JAY GANESH POS server starting on http://127.0.0.1:$($env:PORT)/"
Write-Host 'Keep this PowerShell window open while staff use the POS.'
Write-Host 'Press Ctrl+C to stop. Database is stored in this package folder: data.'
Push-Location $backend
try { & (Join-Path $backend 'node.exe') (Join-Path $backend 'server.mjs') }
finally { Pop-Location }
