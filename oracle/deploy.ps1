# Chess Oracle Server - Windows Deployment Script
# Run as Administrator in PowerShell

$ErrorActionPreference = "Stop"

Write-Host "=== Chess Oracle Server Deployment ===" -ForegroundColor Cyan

# 1. Check Node.js
Write-Host "`n[1/6] Checking Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    Write-Host "  Node.js found: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  Node.js not found! Please install Node.js 18+ from https://nodejs.org" -ForegroundColor Red
    exit 1
}

# 2. Download Stockfish for Windows
Write-Host "`n[2/6] Checking Stockfish..." -ForegroundColor Yellow
$stockfishDir = Join-Path $PSScriptRoot "stockfish"
$stockfishExe = Join-Path $stockfishDir "stockfish.exe"

if (-not (Test-Path $stockfishExe)) {
    Write-Host "  Downloading Stockfish for Windows..." -ForegroundColor Yellow
    $stockfishUrl = "https://github.com/official-stockfish/Stockfish/releases/download/sf_17.1/stockfish-windows-x86-64-avx2.zip"
    $zipPath = Join-Path $PSScriptRoot "stockfish.zip"
    
    try {
        Invoke-WebRequest -Uri $stockfishUrl -OutFile $zipPath -UseBasicParsing
        Expand-Archive -Path $zipPath -DestinationPath $stockfishDir -Force
        Remove-Item $zipPath -Force
        
        # Find the actual exe inside extracted folder
        $foundExe = Get-ChildItem -Path $stockfishDir -Recurse -Filter "stockfish*.exe" | Select-Object -First 1
        if ($foundExe -and $foundExe.FullName -ne $stockfishExe) {
            Copy-Item $foundExe.FullName $stockfishExe -Force
        }
        
        Write-Host "  Stockfish downloaded to: $stockfishExe" -ForegroundColor Green
    } catch {
        Write-Host "  Failed to download Stockfish. Please download manually from:" -ForegroundColor Red
        Write-Host "  https://stockfishchess.org/download/windows/" -ForegroundColor Red
        Write-Host "  Place stockfish.exe in: $stockfishDir" -ForegroundColor Red
    }
} else {
    Write-Host "  Stockfish found: $stockfishExe" -ForegroundColor Green
}

# 3. Update .env with Stockfish path
Write-Host "`n[3/6] Updating .env configuration..." -ForegroundColor Yellow
$envFile = Join-Path $PSScriptRoot ".env"
if (Test-Path $envFile) {
    $envContent = Get-Content $envFile -Raw
    if ($envContent -match "STOCKFISH_PATH=") {
        $envContent = $envContent -replace "STOCKFISH_PATH=.*", "STOCKFISH_PATH=$stockfishExe"
    } else {
        $envContent += "`nSTOCKFISH_PATH=$stockfishExe"
    }
    Set-Content $envFile $envContent
    Write-Host "  .env updated with Stockfish path" -ForegroundColor Green
} else {
    Write-Host "  .env file not found! Please create it from .env template" -ForegroundColor Red
    exit 1
}

# 4. Install dependencies
Write-Host "`n[4/6] Installing npm dependencies..." -ForegroundColor Yellow
Set-Location $PSScriptRoot
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "  npm install failed!" -ForegroundColor Red
    exit 1
}
Write-Host "  Dependencies installed" -ForegroundColor Green

# 5. Build TypeScript
Write-Host "`n[5/6] Building TypeScript..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "  Build successful" -ForegroundColor Green

# 6. Install and configure as Windows Service (using node-windows) or PM2
Write-Host "`n[6/6] Setting up process manager..." -ForegroundColor Yellow

# Check if pm2 is installed
$pm2Installed = $false
try {
    pm2 --version 2>$null
    $pm2Installed = $true
} catch {}

if ($pm2Installed) {
    Write-Host "  PM2 found. Starting oracle server..." -ForegroundColor Green
    pm2 delete chess-oracle 2>$null
    pm2 start (Join-Path $PSScriptRoot "dist\server.js") --name chess-oracle
    pm2 save
    Write-Host "  Oracle server started with PM2" -ForegroundColor Green
    Write-Host "  To auto-start on boot: pm2-startup install" -ForegroundColor Yellow
} else {
    Write-Host "  PM2 not found. Installing PM2 globally..." -ForegroundColor Yellow
    npm install -g pm2
    if ($LASTEXITCODE -eq 0) {
        pm2 start (Join-Path $PSScriptRoot "dist\server.js") --name chess-oracle
        pm2 save
        Write-Host "  Oracle server started with PM2" -ForegroundColor Green
        Write-Host "  To auto-start on boot, run: pm2-startup install" -ForegroundColor Yellow
    } else {
        Write-Host "  Could not install PM2. Starting directly..." -ForegroundColor Yellow
        Write-Host "  Run manually: node dist\server.js" -ForegroundColor Yellow
    }
}

Write-Host "`n=== Deployment Complete ===" -ForegroundColor Cyan
Write-Host "Oracle server should be running on port 3001" -ForegroundColor Green
Write-Host "Check status: pm2 status" -ForegroundColor Yellow
Write-Host "View logs: pm2 logs chess-oracle" -ForegroundColor Yellow
