# CD2 Harness - robo de carregamento do terminal (PowerShell 5.1+). Carregado por core/start-windows.ps1.
# Mesmo desenho do core/robo-unix.sh (quadros em core/robo.txt), com as 16 cores do console.
# O progresso e real: Robo-Ler le o .gguf em pedacos de 8 MB e conta os bytes; Robo-Esperar so anda
# enquanto o processo esta vivo e o /health ainda nao respondeu. Saida redirecionada, NO_COLOR ou
# CD2_SIMPLES=1 caem para linhas de texto. Arquivo so em ASCII: o PowerShell 5.1 le .ps1 sem BOM como ANSI.

$script:RoboFancy = $false
$script:RoboTop = -1
$script:RoboT0 = Get-Date
$script:RoboS = @{}
$script:RoboCor = @{
    'g' = 'Gray'; 'k' = 'DarkGray'; 'b' = 'Blue'; 'w' = 'White'; 'c' = 'Cyan'
    'y' = 'Yellow'; 'p' = 'DarkMagenta'; 'm' = 'Magenta'; 'r' = 'Red'
}
$script:RoboTopo = [string][char]0x2580
$script:RoboBase = [string][char]0x2584

function Robo-Init([string]$sprites) {
    $script:RoboT0 = Get-Date
    $script:RoboFancy = -not ([Console]::IsOutputRedirected -or $env:NO_COLOR -or $env:CD2_SIMPLES -eq '1')
    $script:RoboS = @{}
    $sec = $null
    foreach ($l in (Get-Content -Path $sprites)) {
        if ($l.StartsWith('#')) { continue }
        if ($l.StartsWith('[')) { $sec = $l.Trim('[', ']'); $script:RoboS[$sec] = New-Object System.Collections.ArrayList; continue }
        if ($sec -and $l.Trim()) { [void]$script:RoboS[$sec].Add($l) }
    }
}
function Robo-Seg { return [int]((Get-Date) - $script:RoboT0).TotalSeconds }
function Robo-Gb([double]$b) { return ('{0:0.0}' -f ($b / 1GB)).Replace('.', ',') }

function Robo-Poe($G, [string]$nome, [int]$ox, [int]$oy, [string]$olho, [int]$cheias) {
    $linhas = $script:RoboS[$nome]
    for ($r = 0; $r -lt $linhas.Count; $r++) {
        $linha = $linhas[$r]
        for ($c = 0; $c -lt $linha.Length; $c++) {
            $ch = [string]$linha[$c]
            if ($ch -eq '.') { continue }
            if ($ch -eq 'c') { $ch = $olho }
            if ($ch -eq 'i') { if ($r -gt 6 - $cheias) { $ch = 'm' } else { $ch = 'k' } }
            $yy = $oy + $r; $xx = $ox + $c
            if ($yy -ge 0 -and $yy -lt 12 -and $xx -ge 0 -and $xx -lt 44) { $G[$yy, $xx] = $ch }
        }
    }
}

# fundo $null = fundo do proprio terminal (alguns devolvem -1 em [Console]::BackgroundColor)
function Robo-Escreve([string]$txt, $fg, $bg) {
    if ($bg) { Write-Host $txt -NoNewline -ForegroundColor $fg -BackgroundColor $bg }
    else { Write-Host $txt -NoNewline -ForegroundColor $fg }
}

function Robo-Quadro([string]$estado, [int]$f, [int]$pct, [string]$texto) {
    if (-not $script:RoboFancy) { return }
    $W = 44; $H = 12
    $G = New-Object 'string[,]' $H, $W
    for ($y = 0; $y -lt $H; $y++) { for ($x = 0; $x -lt $W; $x++) { $G[$y, $x] = '.' } }
    $p = [Math]::Max(0, [Math]::Min(100, $pct))
    $cheias = [int][Math]::Floor($p * 6 / 100 + 0.5)
    Robo-Poe $G 'pen' 1 4 'c' $cheias
    Robo-Poe $G 'cerebro' 33 3 'c' $cheias
    $carrega = $false; $dy = 0; $olho = 'c'; $x0 = 25; $corpo = 'roboA'
    switch ($estado) {
        'lendo' {
            $c = $f % 32
            if ($c -lt 16) { $x0 = 10 + $c; $carrega = $true } else { $x0 = 25 - ($c - 16) }
            if ($f % 2) { $corpo = 'roboA' } else { $corpo = 'roboB' }
        }
        'acordando' {
            if ([Math]::Floor($f / 3) % 2) { $corpo = 'roboA' } else { $corpo = 'roboB' }
            if ($f % 15 -eq 0) { $olho = 'g' }
        }
        'pronto' {
            $olho = 'y'; if ($f % 2) { $dy = -1 }
            $G[0, 34] = 'y'; $G[1, 42] = 'y'; $G[2, 31] = 'y'; $G[0, 39] = 'y'
        }
        'erro' { $olho = 'r'; $corpo = 'roboB' }
    }
    Robo-Poe $G $corpo $x0 (2 + $dy) $olho $cheias
    if ($carrega) { Robo-Poe $G 'bloco' ($x0 + 2) $dy 'c' $cheias }

    if ($script:RoboTop -lt 0) {
        [Console]::CursorVisible = $false
        for ($i = 0; $i -lt 7; $i++) { Write-Host '' }
        $script:RoboTop = [Math]::Max(0, [Console]::CursorTop - 7)
    }
    [Console]::SetCursorPosition(0, $script:RoboTop)
    for ($y = 0; $y -lt $H; $y += 2) {
        Write-Host '  ' -NoNewline
        $seg = ''; $fg = $null; $bg = $null
        for ($x = 0; $x -lt $W; $x++) {
            $t = $G[$y, $x]; $b = $G[($y + 1), $x]
            if ($t -eq '.' -and $b -eq '.') { $ch = ' '; $nf = 'Gray'; $nb = $null }
            elseif ($b -eq '.') { $ch = $script:RoboTopo; $nf = $script:RoboCor[$t]; $nb = $null }
            elseif ($t -eq '.') { $ch = $script:RoboBase; $nf = $script:RoboCor[$b]; $nb = $null }
            else { $ch = $script:RoboTopo; $nf = $script:RoboCor[$t]; $nb = $script:RoboCor[$b] }
            if ($seg -and ($nf -ne $fg -or $nb -ne $bg)) { Robo-Escreve $seg $fg $bg; $seg = '' }
            $seg += $ch; $fg = $nf; $bg = $nb
        }
        if ($seg) { Robo-Escreve $seg $fg $bg }
        Write-Host ''
    }
    $linha = '  ' + $texto
    $largura = [Math]::Max(1, [Console]::WindowWidth - 1)
    if ($linha.Length -gt $largura) { $linha = $linha.Substring(0, $largura) }
    Write-Host $linha.PadRight($largura) -ForegroundColor Gray
}

function Robo-Ler([string]$arquivo) {
    if (-not (Test-Path -LiteralPath $arquivo)) { return $false }
    $buf = New-Object byte[] (8MB)
    $fs = $null
    try {
        $fs = [System.IO.File]::OpenRead($arquivo)
        $total = $fs.Length; $lido = [long]0; $q = 0; $dec = -1
        while ($true) {
            $n = $fs.Read($buf, 0, $buf.Length)
            $lido += $n
            $pct = 100; if ($total -gt 0) { $pct = [int][Math]::Floor($lido * 100 / $total) }
            if ($script:RoboFancy) {
                Robo-Quadro 'lendo' $q ([int]($pct * 90 / 100)) ("Lendo o modelo do pen drive  $pct%  $(Robo-Gb $lido) de $(Robo-Gb $total) GB  $(Robo-Seg) s")
            } elseif ([Math]::Floor($pct / 10) -ne $dec) {
                $dec = [Math]::Floor($pct / 10); Write-Host "  Lendo o modelo do pen drive: $pct%" -ForegroundColor Gray
            }
            if ($n -le 0 -or $lido -ge $total) { break }
            $q++
        }
        return $true
    } catch { return $false }
    finally { if ($fs) { $fs.Dispose() } }
}

function Robo-Esperar([string]$url, $proc, [int]$prazo) {
    $q = 0; $ini = Get-Date
    if (-not $script:RoboFancy) { Write-Host '  Acordando o modelo...' -ForegroundColor Gray }
    while ($true) {
        if ($proc.HasExited) { return $false }
        if ($q % 5 -eq 0) {
            try {
                $r = Invoke-WebRequest -UseBasicParsing -Uri "$url/health" -TimeoutSec 1
                if ($r.StatusCode -eq 200) { return $true }
            } catch { }
        }
        if (((Get-Date) - $ini).TotalSeconds -ge $prazo) { return $false }
        Robo-Quadro 'acordando' $q 90 ("Acordando o modelo  $(Robo-Seg) s")
        $q++; Start-Sleep -Milliseconds 200
    }
}

function Robo-Aviso([string]$texto) {
    if ($script:RoboFancy) { Robo-Quadro 'acordando' 1 90 $texto; Start-Sleep -Seconds 1 }
    else { Write-Host "  $texto" -ForegroundColor DarkYellow }
}

function Robo-Fim([string]$estado, [string]$texto) {
    if ($script:RoboFancy) {
        if ($estado -eq 'ok') {
            for ($q = 1; $q -le 6; $q++) { Robo-Quadro 'pronto' $q 100 $texto; Start-Sleep -Milliseconds 150 }
        } else { Robo-Quadro 'erro' 0 90 $texto }
        [Console]::CursorVisible = $true; $script:RoboTop = -1
    } else {
        Write-Host "  $texto" -ForegroundColor Gray
    }
}

function Robo-Restaura { if ($script:RoboFancy) { try { [Console]::CursorVisible = $true } catch { } } }
