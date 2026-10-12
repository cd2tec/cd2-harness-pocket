# CD2 Harness - prepara o pen drive (rode UMA vez, com internet, no Windows)
# Baixa o llamafile e o modelo para dentro desta pasta. Retoma downloads interrompidos.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Root = Split-Path -Parent $PSScriptRoot
$ModelUrl  = if ($env:CD2_MODEL_URL)  { $env:CD2_MODEL_URL }  else { 'https://huggingface.co/pramodlohra/Qween3_4B_thinking_finetune/resolve/main/qwen3-4b-thinking-2507.Q4_K_M.gguf' }
$ModelFile = if ($env:CD2_MODEL_FILE) { $env:CD2_MODEL_FILE } else { 'qwen3-4b-thinking-2507.Q4_K_M.gguf' }
$FallbackBin = 'https://huggingface.co/mozilla-ai/llamafile_0.10/resolve/main/llamafile_0.10.1'

New-Item -ItemType Directory -Force -Path (Join-Path $Root 'bin'), (Join-Path $Root 'models') | Out-Null
$curl = Join-Path $env:SystemRoot 'System32\curl.exe'
if (-not (Test-Path $curl)) { throw 'curl.exe nao encontrado (Windows 10 1803+ ou 11 necessario).' }

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
& $curl -L --fail -C - -o $exe $binUrl
if ($LASTEXITCODE -ne 0) { throw 'Falha ao baixar o llamafile.' }
# mesma binaria (APE) serve para Mac/Linux
Copy-Item -Force $exe (Join-Path $Root 'bin\llamafile')

Write-Host '== Modelo'
Write-Host "Origem: $ModelUrl"
$model = Join-Path $Root "models\$ModelFile"
& $curl -L --fail -C - -o $model $ModelUrl
if ($LASTEXITCODE -ne 0) { throw 'Falha ao baixar o modelo.' }
if ((Get-Item $model).Length -lt 1GB) { throw "Modelo com tamanho suspeito. Apague $model e rode de novo." }

Write-Host ''
Write-Host '== Checksums (anote para conferir depois)'
$lines = foreach ($f in @($exe, $model)) { $h = (Get-FileHash -Algorithm SHA256 $f).Hash.ToLower(); "$h  $([IO.Path]::GetFileName($f))" }
$lines | Tee-Object -FilePath (Join-Path $Root 'CHECKSUMS.sha256')
Write-Host ''
Write-Host "Pronto. Pen drive preparado em: $Root"
Write-Host 'Dica: formate o pen drive em exFAT (FAT32 nao aceita arquivos acima de 4 GB).'
