# CD2 Harness - launcher para Windows (PowerShell 5.1+)
param([switch]$Banco)
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

function Unquote([string]$v) { if ($v -match "^'(.*)'$") { return $Matches[1] -replace "'\\''", "'" } ; return $v }
function Quote([string]$v) { return "'" + ($v -replace "'", "'\''") + "'" }
function Read-DbEnv {
    $h = @{}
    foreach ($line in Get-Content -Encoding UTF8 $DbEnv) { if ($line -match '^([A-Z_]+)=(.*)$') { $h[$Matches[1]] = Unquote $Matches[2] } }
    return $h
}
function Ask-DbEnv {
    Write-Host ''
    Write-Host 'Conectar a um banco de dados? (a IA vai explorar as tabelas em modo somente leitura)'
    Write-Host '  1) PostgreSQL   2) Oracle   3) MariaDB / MySQL   4) SQL Server   0) nenhum, seguir em Demonstracao'
    $op = Read-Host 'Opcao [0]'
    $eng = switch ($op) { '1' { 'postgres' } '2' { 'oracle' } '3' { 'mariadb' } '4' { 'sqlserver' } default { $null } }
    if (-not $eng) { return $false }
    $dport = @{ postgres = '5432'; oracle = '1521'; mariadb = '3306'; sqlserver = '1433' }[$eng]
    $dschema = @{ postgres = 'public'; oracle = ''; mariadb = ''; sqlserver = 'dbo' }[$eng]
    $host_ = Read-Host 'Host'
    $port = Read-Host "Porta [$dport]"; if (-not $port) { $port = $dport }
    $name = Read-Host $(if ($eng -eq 'oracle') { 'Service name' } else { 'Base de dados' })
    $user = Read-Host 'Usuario (use uma conta somente leitura)'
    $sec = Read-Host 'Senha (nao aparece ao digitar)' -AsSecureString
    $pw = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
    if ($eng -eq 'oracle') { $dschema = $user.ToUpperInvariant() } elseif ($eng -eq 'mariadb') { $dschema = $name }
    $schema = Read-Host "Schema [$dschema]"; if (-not $schema) { $schema = $dschema }
    $lines = @("CD2_DB_ENGINE=$(Quote $eng)", "CD2_DB_HOST=$(Quote $host_)", "CD2_DB_PORT=$(Quote $port)", "CD2_DB_NAME=$(Quote $name)",
               "CD2_DB_USER=$(Quote $user)", "CD2_DB_PASSWORD=$(Quote $pw)", "CD2_DB_SCHEMA=$(Quote $schema)")
    [IO.File]::WriteAllText($DbEnv, (($lines -join "`n") + "`n"))
    # ACL: so o usuario atual (remove heranca e os demais)
    $acl = Get-Acl $DbEnv; $acl.SetAccessRuleProtection($true, $false)
    $acl.Access | ForEach-Object { $acl.RemoveAccessRule($_) | Out-Null }
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.WindowsIdentity]::GetCurrent().Name, 'FullControl', 'Allow')))
    Set-Acl $DbEnv $acl
    Write-Host "Conexao guardada em $DbEnv (so neste computador)." -ForegroundColor Gray
    return $true
}
# remove CD2_DB_* do ambiente deste processo: o navegador aberto depois herda o ambiente
function Clear-DbEnvVars { Get-ChildItem Env: | Where-Object { $_.Name -like 'CD2_DB_*' } | ForEach-Object { Remove-Item -Path "Env:$($_.Name)" -ErrorAction SilentlyContinue } }
function Stop-Toolbox { if ($script:TbProc -and -not $script:TbProc.HasExited) { & taskkill.exe /PID $script:TbProc.Id /T /F 2>&1 | Out-Null } }
function Start-Toolbox {
    $src = Join-Path $Root 'bin\toolbox\windows-amd64\toolbox.exe'
    if (-not (Test-Path $src)) { Write-Host 'bin\toolbox\windows-amd64 nao encontrado: sem modo Banco de dados neste pen drive.' -ForegroundColor DarkYellow; return $false }
    $env_ = Read-DbEnv
    $script:DbInfo = "$($env_['CD2_DB_ENGINE']) em $($env_['CD2_DB_HOST']) ($($env_['CD2_DB_NAME']))"
    foreach ($k in $env_.Keys) { Set-Item -Path "Env:$k" -Value $env_[$k] }
    $yaml = Join-Path $Root "core\toolbox\$($env_['CD2_DB_ENGINE']).yaml"
    $tbLog = Join-Path $LogDir 'toolbox.log'; $tbErr = Join-Path $LogDir 'toolbox.err.log'
    $args = @('--config', "`"$yaml`"", '--address', '127.0.0.1', '--port', "$TbPort",
              '--allowed-hosts', "127.0.0.1:$TbPort,localhost:$TbPort",
              '--allowed-origins', "http://127.0.0.1:$Port,http://localhost:$Port", '--disable-reload')
    try {
        $script:TbProc = Start-Process -FilePath $src -ArgumentList $args -WindowStyle Hidden -PassThru -RedirectStandardOutput $tbLog -RedirectStandardError $tbErr
    } finally {
        # o toolbox ja copiou o ambiente; a senha nao fica aqui para o navegador
        $env_ = $null; Clear-DbEnvVars
    }
    for ($i = 0; $i -lt 15; $i++) {
        if ($script:TbProc.HasExited) { break }
        try { $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$TbPort/" -TimeoutSec 2; if ($r.StatusCode -eq 200) { return $true } } catch { }
        Start-Sleep -Seconds 1
    }
    Stop-Toolbox; $script:TbProc = $null
    Write-Host ''; Write-Host "[AVISO] O banco nao respondeu. Ultimas linhas do log ($tbErr):" -ForegroundColor DarkYellow
    Get-Content $tbErr -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "   $_" }
    Write-Host 'Seguindo em Demonstracao. Para corrigir a conexao: INICIAR-CD2-Windows.bat --banco' -ForegroundColor DarkYellow
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
while ((-not (PortFree $Port) -or -not (PortFree ($Port + 1000))) -and $Port -lt ($PortFrom + 20)) { $Port++ }
$Url = "http://127.0.0.1:$Port"
$TbPort = $Port + 1000
$Cache = Join-Path $env:LOCALAPPDATA 'cd2-harness'
New-Item -ItemType Directory -Force -Path $Cache | Out-Null
$DbEnv = Join-Path $Cache 'db.env'
$script:TbProc = $null

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

    $tbSrc = Join-Path $Root 'bin\toolbox\windows-amd64\toolbox.exe'
    if (($Banco -or -not (Test-Path $DbEnv)) -and (Test-Path $tbSrc)) { if (-not (Ask-DbEnv)) { Remove-Item $DbEnv -ErrorAction SilentlyContinue } }
    if (Test-Path $DbEnv) {
        Write-Host "Conectando ao banco (MCP Toolbox em 127.0.0.1:$TbPort)..." -ForegroundColor Gray
        if (Start-Toolbox) { Write-Host "Banco conectado: $script:DbInfo" -ForegroundColor Green }
    }

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
    try { Stop-Toolbox } catch { }
    try { Stop-Server } catch { }
}
