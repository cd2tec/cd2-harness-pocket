# CD2 Harness - launcher para Windows (PowerShell 5.1+)
$ErrorActionPreference = 'Stop'
$Root   = Split-Path -Parent $PSScriptRoot
$Ctx    = if ($env:CD2_CTX) { $env:CD2_CTX } else { '8192' }
$PortFrom = if ($env:CD2_PORT) { [int]$env:CD2_PORT } else { 8080 }
$LogDir = Join-Path $env:TEMP 'cd2-harness'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log    = Join-Path $LogDir 'server.log'
$LogErr = Join-Path $LogDir 'server.err.log'
$script:Proc = $null

function Fail($msg) {
    Write-Host ""
    Write-Host "[ERRO] $msg" -ForegroundColor Red
    Read-Host "Pressione ENTER para sair"
    exit 1
}
function PortFree([int]$p) {
    try {
        $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p)
        $l.Start(); $l.Stop(); return $true
    } catch { return $false }
}
function Stop-Server {
    if ($script:Proc -and -not $script:Proc.HasExited) {
        & taskkill.exe /PID $script:Proc.Id /T /F 2>&1 | Out-Null
    }
}
function Start-Server([string[]]$extra) {
    Stop-Server
    Set-Content -Path $Log -Value '' ; Set-Content -Path $LogErr -Value ''
    $args = @('-m', "`"$Model`"", '--server', '--host', '127.0.0.1', '--port', "$Port",
              '--jinja', '-c', $Ctx, '--path', "`"$(Join-Path $Root 'web')`"") + $extra
    $script:Proc = Start-Process -FilePath $Exe -ArgumentList $args -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $Log -RedirectStandardError $LogErr
}
function Wait-Ready {
    for ($i = 0; $i -lt 240; $i++) {
        if ($script:Proc.HasExited) { return $false }
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri "$Url/health" -TimeoutSec 2
            if ($r.StatusCode -eq 200) { return $true }
        } catch { }
        Start-Sleep -Seconds 1
    }
    return $false
}

Clear-Host
Write-Host ""
Write-Host "  +-----------------------------+" -ForegroundColor DarkYellow
Write-Host "  |   CD2 Retail Tech  Harness  |" -ForegroundColor Yellow
Write-Host "  +-----------------------------+" -ForegroundColor DarkYellow
Write-Host "  IA local, sem nuvem." -ForegroundColor Gray
Write-Host ""

$Exe = Join-Path $Root 'bin\llamafile.exe'
if (-not (Test-Path $Exe)) { Fail "bin\llamafile.exe nao encontrado. Rode a preparacao do pen drive (core\prepare-windows.bat)." }
$ModelFile = Get-ChildItem -Path (Join-Path $Root 'models') -Filter *.gguf -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $ModelFile) { Fail "Nenhum modelo .gguf em models\. Rode a preparacao do pen drive." }
$Model = $ModelFile.FullName

$Port = $PortFrom
while (-not (PortFree $Port) -and $Port -lt ($PortFrom + 20)) { $Port++ }
$Url = "http://127.0.0.1:$Port"

try {
    Write-Host "Carregando o modelo: $($ModelFile.Name)" -ForegroundColor Gray
    Write-Host "(na primeira vez pode levar de 20 a 90 segundos)" -ForegroundColor DarkGray
    Start-Server @('-ngl', '999')
    if (-not (Wait-Ready)) {
        Write-Host "Aceleracao por GPU indisponivel, tentando so com CPU..." -ForegroundColor DarkYellow
        Start-Server @('--gpu', 'disable', '-ngl', '0')
        if (-not (Wait-Ready)) {
            if (Test-Path $LogErr) { Get-Content $LogErr -Tail 25 }
            Fail "O servidor nao iniciou. Logs em $LogDir"
        }
    }

    Write-Host ""
    Write-Host "Pronto: $Url" -ForegroundColor Green

    # abre como janela de aplicativo (Edge vem com o Windows; Chrome como alternativa)
    $cands = @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    $browser = $cands | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($browser) { Start-Process -FilePath $browser -ArgumentList @("--app=$Url", '--window-size=1280,860') }
    else { Start-Process $Url }

    Write-Host ""
    Write-Host "O harness esta rodando. Para encerrar, pressione ENTER nesta janela." -ForegroundColor Gray
    while (-not $script:Proc.HasExited) {
        if ([Console]::KeyAvailable) { $k = [Console]::ReadKey($true); if ($k.Key -eq 'Enter') { break } }
        Start-Sleep -Milliseconds 400
    }
}
finally {
    Stop-Server
}
