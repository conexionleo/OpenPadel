# Servidor estático mínimo para desarrollo local (no es necesario en GitHub Pages).
# Uso local:   powershell -ExecutionPolicy Bypass -File .\tools\serve.ps1 -Port 8123
# Uso en LAN:  powershell -ExecutionPolicy Bypass -File .\tools\serve.ps1 -Port 8123 -Lan
param(
  [int]$Port = 8123,
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [switch]$Lan
)

$ErrorActionPreference = 'Stop'
$bindAddress = if ($Lan) { [System.Net.IPAddress]::Any } else { [System.Net.IPAddress]::Loopback }
$listener = [System.Net.Sockets.TcpListener]::new($bindAddress, $Port)
$listener.Start()
if ($Lan) {
  Write-Host "Open Padel dev server (LAN) -> puerto $Port"
  $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254*' } |
    Select-Object -ExpandProperty IPAddress
  foreach ($ip in $ips) { Write-Host "  http://${ip}:$Port" }
  Write-Host "Aviso: el micrófono necesita HTTPS; en http://IP solo funciona el marcador manual."
} else {
  Write-Host "Open Padel dev server -> http://localhost:$Port"
}
Write-Host "Raiz: $Root"

$types = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.mjs'  = 'application/javascript; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.webp' = 'image/webp'
  '.ico'  = 'image/x-icon'
  '.json' = 'application/json; charset=utf-8'
  '.md'   = 'text/plain; charset=utf-8'
  '.txt'  = 'text/plain; charset=utf-8'
}

function Send-Response {
  param($Stream, [int]$Status, [string]$StatusText, [string]$ContentType, [byte[]]$Body, [bool]$HeadOnly = $false)
  $header = "HTTP/1.1 $Status $StatusText`r`n" +
            "Content-Type: $ContentType`r`n" +
            "Content-Length: $($Body.Length)`r`n" +
            "Cache-Control: no-store`r`n" +
            "Connection: close`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  if (-not $HeadOnly -and $Body.Length -gt 0) {
    $Stream.Write($Body, 0, $Body.Length)
  }
  $Stream.Flush()
}

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $client.ReceiveTimeout = 5000
    $client.SendTimeout = 5000
    $stream = $client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 2048, $true)
    $requestLine = $reader.ReadLine()
    if ([string]::IsNullOrWhiteSpace($requestLine)) { continue }

    $parts = $requestLine.Split(' ')
    $method = $parts[0]
    $rawTarget = if ($parts.Length -ge 2) { $parts[1] } else { '/' }

    # Consumir cabeceras.
    while ($true) {
      $line = $reader.ReadLine()
      if ($null -eq $line -or $line -eq '') { break }
    }

    $headOnly = $false
    if ($method -eq 'HEAD') { $headOnly = $true }
    elseif ($method -ne 'GET') {
      Send-Response $stream 405 'Method Not Allowed' 'text/plain; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes('405')) $headOnly
      continue
    }

    $path = [Uri]::UnescapeDataString(($rawTarget.Split('?')[0]))
    if ([string]::IsNullOrEmpty($path) -or $path -eq '/') { $path = '/index.html' }

    $relative = $path.TrimStart('/') -replace '/', [System.IO.Path]::DirectorySeparatorChar
    $full = [System.IO.Path]::GetFullPath((Join-Path $Root $relative))
    $rootFull = [System.IO.Path]::GetFullPath($Root)
    if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
      Send-Response $stream 403 'Forbidden' 'text/plain; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes('403')) $headOnly
      continue
    }

    if ((Test-Path $full -PathType Container)) { $full = Join-Path $full 'index.html' }

    if (-not (Test-Path $full -PathType Leaf)) {
      Send-Response $stream 404 'Not Found' 'text/plain; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes('404: ' + $path)) $headOnly
      continue
    }

    $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
    $contentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
    $body = [System.IO.File]::ReadAllBytes($full)
    Send-Response $stream 200 'OK' $contentType $body $headOnly
  }
  catch {
    Write-Host ("Error: " + $_.Exception.Message)
  }
  finally {
    try { $client.Close() } catch { }
  }
}
