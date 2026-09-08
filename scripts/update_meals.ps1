<#
.SYNOPSIS
    Automated Build & Sync Script for the MEALS Distribution Package.
.DESCRIPTION
    1. Builds the latest React/Vite web application.
    2. Packages the Electron Windows desktop client (NSIS Setup & Portable .exe).
    3. Copies the newly generated executables into MEALS/Client/.
    4. Synchronizes backend requirements and server deployment scripts into MEALS/Server/.
    5. Updates MEALS/version.json with build metadata and timestamps.
#>

[CmdletBinding()]
param (
    [switch]$SkipClientBuild,
    [switch]$CreateServerZip
)

$ErrorActionPreference = "Stop"

# Determine Workspace Root
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
if (-not (Test-Path "$RootDir\MEALS")) {
    $RootDir = (Get-Location).Path
}

$SmartCanteenDir = Join-Path $RootDir "smartcanteen"
$MealsDir = Join-Path $RootDir "MEALS"
$ClientDistDir = Join-Path $MealsDir "Client"
$ServerDistDir = Join-Path $MealsDir "Server"
$DistElectronDir = Join-Path $SmartCanteenDir "dist-electron"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "       MEALS Package Automated Update & Build Tool        " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Root Directory: $RootDir" -ForegroundColor Gray

# 1. Check for running MEALS processes that could lock executable files
$runningMeals = Get-Process -Name "MEALS" -ErrorAction SilentlyContinue
if ($runningMeals) {
    Write-Warning "Detected running MEALS.exe process(es). Closing them to prevent file locking..."
    Stop-Process -Name "MEALS" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

# 2. Read package version
$packageJsonPath = Join-Path $SmartCanteenDir "package.json"
$appVersion = "1.0.0"
if (Test-Path $packageJsonPath) {
    try {
        $packageData = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
        $appVersion = $packageData.version
    } catch {
        Write-Warning "Could not parse package.json version, defaulting to 1.0.0"
    }
}
Write-Host "`n[Target Version: v$appVersion]" -ForegroundColor Yellow

# Ensure destination folders exist
if (-not (Test-Path $ClientDistDir)) { New-Item -ItemType Directory -Path $ClientDistDir -Force | Out-Null }
if (-not (Test-Path $ServerDistDir)) { New-Item -ItemType Directory -Path $ServerDistDir -Force | Out-Null }

# 3. Build Client Executables
if (-not $SkipClientBuild) {
    Write-Host "`n==> Step 1/3: Building MEALS Desktop Client (Vite + Electron)..." -ForegroundColor Green
    
    if (-not (Test-Path "$SmartCanteenDir\node_modules")) {
        Write-Host "Installing npm dependencies in smartcanteen..." -ForegroundColor Gray
        Push-Location $SmartCanteenDir
        npm install
        Pop-Location
    }

    Push-Location $SmartCanteenDir
    try {
        Write-Host "Running: npm run electron:build..." -ForegroundColor Gray
        & npm run electron:build
        if ($LASTEXITCODE -ne 0) {
            throw "electron-builder failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }

    Write-Host "`n==> Step 2/3: Copying Client Binaries into MEALS/Client/..." -ForegroundColor Green
    
    $setupSrc = Join-Path $DistElectronDir "MEALS Setup.exe"
    $portableSrc = Join-Path $DistElectronDir "MEALS.exe"
    
    $setupDest = Join-Path $ClientDistDir "MEALS Setup.exe"
    $portableDest = Join-Path $ClientDistDir "MEALS.exe"

    if (Test-Path $setupSrc) {
        Copy-Item -Path $setupSrc -Destination $setupDest -Force
        $setupSizeMb = [math]::Round((Get-Item $setupDest).Length / 1MB, 2)
        Write-Host "  [OK] Updated: MEALS/Client/MEALS Setup.exe ($setupSizeMb MB)" -ForegroundColor Green
    } else {
        Write-Warning "Could not find $setupSrc"
    }

    if (Test-Path $portableSrc) {
        Copy-Item -Path $portableSrc -Destination $portableDest -Force
        $portableSizeMb = [math]::Round((Get-Item $portableDest).Length / 1MB, 2)
        Write-Host "  [OK] Updated: MEALS/Client/MEALS.exe ($portableSizeMb MB)" -ForegroundColor Green
    } else {
        Write-Warning "Could not find $portableSrc"
    }
} else {
    Write-Host "`n[Skipping Client build as requested]" -ForegroundColor DarkYellow
}

# 4. Synchronize Server Package
Write-Host "`n==> Step 3/3: Synchronizing MEALS Server Configurations..." -ForegroundColor Green

$backendReq = Join-Path $RootDir "backend\requirements.txt"
$serverReq = Join-Path $ServerDistDir "requirements.txt"
if (Test-Path $backendReq) {
    Copy-Item -Path $backendReq -Destination $serverReq -Force
    Write-Host "  [OK] Synced: MEALS/Server/requirements.txt" -ForegroundColor Green
}

# Optional Server Zip Package
if ($CreateServerZip) {
    Write-Host "Creating deployable MEALS/Server/meals-backend.zip archive..." -ForegroundColor Gray
    $serverZipDest = Join-Path $ServerDistDir "meals-backend.zip"
    if (Test-Path $serverZipDest) { Remove-Item $serverZipDest -Force }
    
    $tempBackendZipDir = Join-Path $RootDir "scratch\temp_server_pkg"
    if (Test-Path $tempBackendZipDir) { Remove-Item $tempBackendZipDir -Recurse -Force }
    New-Item -ItemType Directory -Path "$tempBackendZipDir\backend" -Force | Out-Null
    
    Get-ChildItem -Path "$RootDir\backend" -Recurse -File | Where-Object {
        $_.FullName -notmatch "node_modules" -and
        $_.FullName -notmatch "venv" -and
        $_.FullName -notmatch "__pycache__" -and
        $_.FullName -notmatch "\.log$" -and
        $_.FullName -notmatch "canteen\.db"
    } | ForEach-Object {
        $relPath = Resolve-Path -Path $_.FullName -Relative
        $targetFile = Join-Path $tempBackendZipDir ($relPath -replace "^\.\\", "")
        $targetDir = Split-Path -Parent $targetFile
        if (-not (Test-Path $targetDir)) { New-Item -ItemType Directory -Path $targetDir -Force | Out-Null }
        Copy-Item -Path $_.FullName -Destination $targetFile -Force
    }
    
    Copy-Item -Path "$RootDir\app.py" -Destination $tempBackendZipDir -Force -ErrorAction SilentlyContinue
    Copy-Item -Path "$ServerDistDir\*" -Destination "$tempBackendZipDir\MEALS\Server" -Recurse -Force -Exclude "*.zip"
    
    Compress-Archive -Path "$tempBackendZipDir\*" -DestinationPath $serverZipDest -Force
    Remove-Item $tempBackendZipDir -Recurse -Force
    $zipSizeMb = [math]::Round((Get-Item $serverZipDest).Length / 1MB, 2)
    Write-Host "  [OK] Created: MEALS/Server/meals-backend.zip ($zipSizeMb MB)" -ForegroundColor Green
}

# 5. Write Release Metadata
$releaseMeta = @{
    version = $appVersion
    updated_at = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    client = @{
        installer = if (Test-Path "$ClientDistDir\MEALS Setup.exe") { (Get-Item "$ClientDistDir\MEALS Setup.exe").Length } else { 0 }
        portable = if (Test-Path "$ClientDistDir\MEALS.exe") { (Get-Item "$ClientDistDir\MEALS.exe").Length } else { 0 }
    }
    server = @{
        requirements = Test-Path "$ServerDistDir\requirements.txt"
        service = Test-Path "$ServerDistDir\meals-backend.service"
        nginx = Test-Path "$ServerDistDir\nginx.conf"
        init_db = Test-Path "$ServerDistDir\init_db.py"
    }
}

$releaseMetaPath = Join-Path $MealsDir "version.json"
$releaseMeta | ConvertTo-Json -Depth 4 | Set-Content -Path $releaseMetaPath -Encoding UTF8
Write-Host "  [OK] Updated: MEALS/version.json" -ForegroundColor Green

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "     MEALS Folder Successfully Updated! (v$appVersion)     " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Client Artifacts: $ClientDistDir" -ForegroundColor White
Write-Host "Server Artifacts: $ServerDistDir" -ForegroundColor White
Write-Host "Build Timestamp : $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor White
