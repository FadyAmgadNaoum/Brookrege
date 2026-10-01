# Brookrege - start the whole site on this computer (Windows). Run by start-brookrege.bat.
# 1. makes sure Docker Desktop is running
# 2. makes sure no other project (e.g. another site on port 3000) is using Brookrege's ports - offers to stop it
# 3. builds and starts the website, admin, API and database
# 4. waits until the real Brookrege site answers, then opens it in the browser
# Messages are plain ASCII on purpose: Windows PowerShell 5.1 misreads UTF-8 scripts without a BOM.
# "Continue": in Windows PowerShell 5.1, "Stop" turns any line Docker prints on stderr into a crash.
$ErrorActionPreference = "Continue"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root
$Docker = if ($env:BROOKREGE_DOCKER) { $env:BROOKREGE_DOCKER } else { "docker" }
$Log = Join-Path $Root "brookrege-start-log.txt"

function Say($msg, $color = "Gray") { Write-Host $msg -ForegroundColor $color }
function Fail($msg) {
  Say ""
  Say "X  $msg" "Red"
  Say ""
  if ($env:BROOKREGE_NO_PAUSE -ne "1") { Read-Host "Press Enter to close" | Out-Null }
  exit 1
}
function PortSetting($name, $default) {
  $v = [Environment]::GetEnvironmentVariable($name)
  if (-not $v -and (Test-Path ".env")) {
    $line = Get-Content ".env" | Where-Object { $_ -match "^\s*$name\s*=" } | Select-Object -Last 1
    if ($line) { $v = ($line -split "=", 2)[1].Trim().Trim('"') }
  }
  if ($v) { return [int]$v } else { return $default }
}

Say ""
Say "Brookrege - starting the website on this computer" "Yellow"
Say "--------------------------------------------------"

# 1. Docker
if (-not (Get-Command $Docker -ErrorAction SilentlyContinue)) {
  Fail "Docker Desktop is not installed. Install it from https://www.docker.com/products/docker-desktop/ , open it once, then run start-brookrege.bat again."
}
function DockerReady { & $Docker info *> $null; return ($LASTEXITCODE -eq 0) }
if (-not (DockerReady)) {
  $exe = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
  if (Test-Path $exe) { Say "Starting Docker Desktop..."; Start-Process $exe | Out-Null }
  Say "Waiting for Docker to be ready (up to 3 minutes)..."
  $ok = $false
  for ($i = 0; $i -lt 90; $i++) { Start-Sleep -Seconds 2; if (DockerReady) { $ok = $true; break } }
  if (-not $ok) { Fail "Docker is not running. Open Docker Desktop, wait until it says 'Engine running', then run start-brookrege.bat again." }
}
Say "OK  Docker is running" "Green"

# 2. Ports
$Ports = [ordered]@{
  "website"   = PortSetting "WEB_PORT" 3000
  "admin"     = PortSetting "ADMIN_PORT" 3001
  "API"       = PortSetting "API_PORT" 4000
  "database"  = PortSetting "DB_PORT" 5434
}
$DockerProcs = @("com.docker.backend", "com.docker.proxy", "wslrelay", "vpnkit", "dockerd", "Docker Desktop", "docker-proxy")
foreach ($what in $Ports.Keys) {
  $port = $Ports[$what]
  # Containers of another project publishing this port (for example rawasi-frontend on 3000).
  $names = @(& $Docker ps --filter "publish=$port" --format "{{.Names}}" 2>$null | Where-Object { $_ -and ($_ -notmatch "^brookrege[-_]") })
  if ($names.Count -gt 0) {
    $list = $names -join ", "
    Say ""
    Say "!  Port $port (Brookrege $what) is being used by another project's container: $list" "Yellow"
    Say "   That is why http://localhost:$port showed a different site."
    $answer = if ($env:BROOKREGE_YES -eq "1") { "y" } else { Read-Host "   Stop it so Brookrege can use the port? Nothing is deleted - you can start it again from Docker Desktop. [Y/n]" }
    if ($answer -match "^(n|no)$") { Fail "Brookrege needs port $port. Stop '$list' in Docker Desktop (Containers > Stop), or set a different port in a file named .env (see README), then run again." }
    foreach ($n in $names) { & $Docker stop $n *> $null; Say "OK  Stopped $n" "Green" }
    Start-Sleep -Seconds 2
  }
  # A program (not Docker) listening on the port, e.g. "npm run dev" of another project.
  if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    $conns = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
    foreach ($c in $conns) {
      $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
      if ($p -and ($DockerProcs -notcontains $p.ProcessName) -and ($p.ProcessName -notmatch "^com\.docker")) {
        Fail "Port $port (Brookrege $what) is used by the program '$($p.ProcessName)' (process $($p.Id)). Close that program (or its terminal window), then run start-brookrege.bat again."
      }
    }
  }
}
Say "OK  Ports are free for Brookrege: website $($Ports['website']), admin $($Ports['admin']), API $($Ports['API'])" "Green"

# 3. Build and start
Say ""
Say "Building and starting (the first time takes 5-15 minutes; later starts take seconds)..."
& $Docker compose up -d --build
if ($LASTEXITCODE -ne 0) {
  & $Docker compose ps -a *> $Log
  & $Docker compose logs --tail 80 *>> $Log
  Fail "Brookrege could not start. The details are saved in brookrege-start-log.txt in this folder - send that file for help."
}

# 4. Wait for the real site
$web = "http://localhost:$($Ports['website'])"
$admin = "http://localhost:$($Ports['admin'])"
$api = "http://localhost:$($Ports['API'])"
Say "Waiting for the site to answer..."
$ready = $false
$other = $false
$timeout = if ($env:BROOKREGE_WAIT_SECONDS) { [int]$env:BROOKREGE_WAIT_SECONDS } else { 600 }
$deadline = (Get-Date).AddSeconds($timeout)
while ((Get-Date) -lt $deadline) {
  try {
    $r = Invoke-WebRequest -Uri "$web/ar" -UseBasicParsing -TimeoutSec 5
    if ($r.Content -match "Brookrege") { $ready = $true; break }
    $other = $true
  } catch { }
  Start-Sleep -Seconds 3
}
if (-not $ready) {
  & $Docker compose ps -a *> $Log
  & $Docker compose logs --tail 80 *>> $Log
  if ($other) { Fail "$web answers, but with a different site - another program is using port $($Ports['website']). Close it and run again." }
  Fail "The site did not answer within $([int]($timeout / 60)) minutes. The details are saved in brookrege-start-log.txt - send that file for help."
}

Say ""
Say "Brookrege is running" "Green"
Say "  Website          $web            (Arabic; English in the header)"
Say "  Admin dashboard  $admin          admin@brookrege.com / Brookrege-Demo-2026!"
Say "  API health       $api/health"
Say ""
Say "Stop it with stop-brookrege.bat (your data is kept)."
if ($env:BROOKREGE_NO_BROWSER -ne "1") { Start-Process $web; Start-Process "$admin/login" }
if ($env:BROOKREGE_NO_PAUSE -ne "1") { Read-Host "Press Enter to close this window (the site keeps running)" | Out-Null }
