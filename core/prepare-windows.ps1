# CD2 Harness - prepara o pen drive (rode UMA vez, com internet, no Windows)
# Baixa o llamafile e o modelo para dentro desta pasta. Retoma downloads interrompidos
# e pula o que ja estiver completo, entao pode rodar de novo sem medo.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Root = Split-Path -Parent $PSScriptRoot
$ModelUrl  = if ($env:CD2_MODEL_URL)  { $env:CD2_MODEL_URL }  else { 'https://huggingface.co/pramodlohra/Qween3_4B_thinking_finetune/resolve/main/qwen3-4b-thinking-2507.Q4_K_M.gguf' }
$ModelFile = if ($env:CD2_MODEL_FILE) { $env:CD2_MODEL_FILE } else { 'qwen3-4b-thinking-2507.Q4_K_M.gguf' }
$FallbackBin = 'https://huggingface.co/mozilla-ai/llamafile_0.10/resolve/main/llamafile_0.10.1'

New-Item -ItemType Directory -Force -Path (Join-Path $Root 'bin'), (Join-Path $Root 'models') | Out-Null
$curl = Join-Path $env:SystemRoot 'System32\curl.exe'
if (-not (Test-Path $curl)) { throw 'curl.exe nao encontrado (Windows 10 1803+ ou 11 necessario).' }

# Tamanho do arquivo no servidor (segue redirecionamentos). $null se nao der para saber.
function Get-RemoteSize($url) {
    try {
        $r = Invoke-WebRequest -Uri $url -Method Head -MaximumRedirection 10 -UseBasicParsing -Headers @{ 'User-Agent' = 'cd2-harness' }
        $len = $r.Headers['Content-Length']
        if ($len) { return [int64]($len | Select-Object -Last 1) }
    } catch { }
    return $null
}

# Fetch URL DESTINO: pula se ja estiver completo, retoma se estiver pela metade.
function Fetch($url, $dest) {
    if ((Test-Path $dest) -and (Get-Item $dest).Length -gt 0) {
        $have = (Get-Item $dest).Length
        $want = Get-RemoteSize $url
        if ($want -and $want -eq $have) { Write-Host "Ja baixado, pulando: $([IO.Path]::GetFileName($dest)) ($have bytes)"; return }
        & $curl -L --fail -C - -o $dest $url
        if ($LASTEXITCODE -ne 0) { & $curl -L --fail -o $dest $url }
    } else {
        & $curl -L --fail -C - -o $dest $url
    }
    if ($LASTEXITCODE -ne 0) { throw "Falha ao baixar $url" }
}

Write-Host '== Motor (llamafile)'
$binUrl = $null
try {
    $rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/mozilla-ai/llamafile/releases/latest' -Headers @{ 'User-Agent' = 'cd2-harness' }
    $asset = $rel.assets | Where-Object { $_.name -match '^llamafile-\d+(\.\d+)+$' } | Select-Object -First 1
    if ($asset) { $binUrl = $asset.browser_download_url }
} catch { }
if (-not $binUrl) { Write-Host 'Nao consegui resolver a ultima release; usando a URL de reserva.'; $binUrl = $FallbackBin }
Write-Host "Origem: $binUrl"
$exe = Join-Path $Root 'bin\llamafile.exe'
$bin = Join-Path $Root 'bin\llamafile'
Fetch $binUrl $exe
# mesma binaria (APE) serve para Mac/Linux
if (-not (Test-Path $bin) -or (Get-Item $bin).Length -ne (Get-Item $exe).Length) { Copy-Item -Force $exe $bin }

Write-Host '== Modelo'
Write-Host "Origem: $ModelUrl"
$model = Join-Path $Root "models\$ModelFile"
Fetch $ModelUrl $model
if ((Get-Item $model).Length -lt 1GB) { throw "Modelo com tamanho suspeito. Apague $model e rode de novo." }

Write-Host ''
Write-Host '== Checksums (anote para conferir depois)'
# Mesmo formato do Mac/Linux (caminhos relativos com /), para o mesmo arquivo valer nos tres sistemas.
$lines = @(
    "$((Get-FileHash -Algorithm SHA256 $bin).Hash.ToLower())  bin/llamafile",
    "$((Get-FileHash -Algorithm SHA256 $model).Hash.ToLower())  models/$ModelFile"
)
$lines | ForEach-Object { Write-Host $_ }
[IO.File]::WriteAllText((Join-Path $Root 'CHECKSUMS.sha256'), (($lines -join "`n") + "`n"))
Write-Host ''
Write-Host "Pronto. Pen drive preparado em: $Root"
Write-Host 'Dica: formate o pen drive em exFAT (FAT32 nao aceita arquivos acima de 4 GB).'
