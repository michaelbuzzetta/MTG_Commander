# MTG Commander - Windows Full Bootstrap
# Run in PowerShell from the root of the cloned MTG_Commander repository.
$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

Write-Host "=============================================="
Write-Host " MTG Commander - Windows Full Setup"
Write-Host "=============================================="
Write-Host "This installs/checks WinGet, Node 22, MongoDB,"
Write-Host "project dependencies, starts MongoDB, and verifies setup."
Write-Host ""

function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machine;$user"
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: WinGet is required."
    Write-Host "Install/update 'App Installer' from Microsoft, then rerun this script."
    exit 1
}

Write-Host "WinGet detected."

# Node.js 22 LTS. Install when Node is absent or not major version 22.
$needNode = $true
if (Get-Command node -ErrorAction SilentlyContinue) {
    $major = (& node -p "process.versions.node.split('.')[0]").Trim()
    if ($major -eq "22") { $needNode = $false }
}

if ($needNode) {
    Write-Host "Installing Node.js 22 LTS..."
    winget install --id OpenJS.NodeJS.LTS --exact --accept-source-agreements --accept-package-agreements
    Refresh-Path
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Node.js installation completed but node is not in PATH."
    Write-Host "Close PowerShell, reopen it, and rerun this setup."
    exit 1
}

Write-Host "Node: $(& node -v)"
Write-Host "npm:  $(& npm -v)"

# MongoDB Community Server
$mongoService = Get-Service -Name "MongoDB" -ErrorAction SilentlyContinue
if (-not $mongoService) {
    Write-Host "Installing MongoDB Community Server..."
    winget install --id MongoDB.Server --exact --accept-source-agreements --accept-package-agreements
    Refresh-Path
}

$mongoService = Get-Service -Name "MongoDB" -ErrorAction SilentlyContinue
if ($mongoService) {
    if ($mongoService.Status -ne "Running") {
        Write-Host "Starting MongoDB service..."
        try {
            Start-Service MongoDB
        } catch {
            Write-Host "MongoDB needs administrator permission to start."
            Write-Host "Open PowerShell as Administrator and rerun this setup."
            exit 1
        }
    }
} else {
    Write-Host "ERROR: MongoDB installed but the MongoDB Windows service was not found."
    Write-Host "Reboot or rerun this setup from an Administrator PowerShell."
    exit 1
}

# Wait for localhost:27017.
Write-Host "Waiting for MongoDB on 127.0.0.1:27017..."
$deadline = (Get-Date).AddSeconds(30)
$ready = $false
while ((Get-Date) -lt $deadline) {
    try {
        $client = [System.Net.Sockets.TcpClient]::new()
        $client.Connect("127.0.0.1", 27017)
        $client.Close()
        $ready = $true
        break
    } catch {
        Start-Sleep -Milliseconds 500
    }
}
if (-not $ready) {
    Write-Host "ERROR: MongoDB did not become reachable on 127.0.0.1:27017."
    exit 1
}
Write-Host "MongoDB is reachable."

if (-not (Test-Path ".\package.json")) {
    Write-Host "ERROR: package.json was not found."
    Write-Host "Put this file in the MTG_Commander repository root and run it there."
    exit 1
}

Write-Host "Installing project dependencies..."
if (Test-Path ".\package-lock.json") {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) {
        Write-Host "npm ci failed; falling back to npm install to repair dependency metadata."
        & npm.cmd install
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
} else {
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host ""
Write-Host "Running architecture check..."
& npm.cmd run check:architecture
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "=============================================="
Write-Host " SETUP COMPLETE"
Write-Host "=============================================="
Write-Host "Node:    $(& node -v)"
Write-Host "npm:     $(& npm -v)"
Write-Host "MongoDB: reachable at 127.0.0.1:27017"
Write-Host ""
Write-Host "Start the full game with:"
Write-Host "  npm run dev"
Write-Host ""
Read-Host "Press Enter to close"
