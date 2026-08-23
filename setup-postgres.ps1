# PostgreSQL Setup Script for ScenePass
# Run this in an ADMIN PowerShell: Right-click PowerShell -> "Run as Administrator"

Write-Host "=== ScenePass PostgreSQL Setup ===" -ForegroundColor Cyan

# Step 1: Install PostgreSQL via Chocolatey
Write-Host "`n[1/4] Installing PostgreSQL 17..." -ForegroundColor Yellow
choco install postgresql17 --params "/Password:postgres" -y --force

# Step 2: Refresh PATH
Write-Host "`n[2/4] Refreshing PATH..." -ForegroundColor Yellow
$pgPath = "C:\Program Files\PostgreSQL\17\bin"
if (Test-Path $pgPath) {
    $env:Path = "$pgPath;$env:Path"
    Write-Host "PostgreSQL found at: $pgPath" -ForegroundColor Green
} else {
    # Try to find it
    $found = Get-ChildItem "C:\Program Files\PostgreSQL" -Recurse -Filter "psql.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) {
        $pgPath = Split-Path $found.FullName
        $env:Path = "$pgPath;$env:Path"
        Write-Host "PostgreSQL found at: $pgPath" -ForegroundColor Green
    } else {
        Write-Host "ERROR: PostgreSQL installation not found!" -ForegroundColor Red
        exit 1
    }
}

# Step 3: Create the scenepass database
Write-Host "`n[3/4] Creating 'scenepass' database..." -ForegroundColor Yellow
$env:PGPASSWORD = "postgres"
& "$pgPath\psql.exe" -U postgres -c "CREATE DATABASE scenepass;" 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Database 'scenepass' created successfully!" -ForegroundColor Green
} else {
    Write-Host "Database may already exist (that's OK)" -ForegroundColor Yellow
}

# Step 4: Test connection
Write-Host "`n[4/4] Testing connection..." -ForegroundColor Yellow
& "$pgPath\psql.exe" -U postgres -d scenepass -c "SELECT 'Connection successful!' AS status;"
if ($LASTEXITCODE -eq 0) {
    Write-Host "`n=== PostgreSQL is ready! ===" -ForegroundColor Green
    Write-Host "Connection string: postgresql://postgres:postgres@localhost:5432/scenepass" -ForegroundColor Cyan
    Write-Host "`nYou can now close this Admin window and return to your regular terminal." -ForegroundColor White
} else {
    Write-Host "ERROR: Connection test failed!" -ForegroundColor Red
}
