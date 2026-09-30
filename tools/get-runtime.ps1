# Скачивает переносной Node.js для Windows в папку runtime\ и сверяет контрольную сумму с официальной.
# Запуск: powershell -ExecutionPolicy Bypass -File tools\get-runtime.ps1
$ErrorActionPreference = 'Stop'
$ver = 'v24.19.0'
$name = "node-$ver-win-x64"
$root = Split-Path -Parent $PSScriptRoot
$tmp = Join-Path $env:TEMP 'profil-runtime'
New-Item -ItemType Directory -Force $tmp | Out-Null
$zip = Join-Path $tmp "$name.zip"
Invoke-WebRequest "https://nodejs.org/dist/$ver/$name.zip" -OutFile $zip
$sums = (Invoke-WebRequest "https://nodejs.org/dist/$ver/SHASUMS256.txt" -UseBasicParsing).Content
$want = ($sums -split "`n" | Where-Object { $_ -match "$name.zip" }) -split '\s+' | Select-Object -First 1
$got = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
if ($got -ne $want) { throw "Контрольная сумма не совпала: $got <> $want" }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [IO.Compression.ZipFile]::OpenRead($zip)
New-Item -ItemType Directory -Force (Join-Path $root 'runtime') | Out-Null
foreach ($f in 'node.exe', 'LICENSE') {
  $e = $z.GetEntry("$name/$f")
  [IO.Compression.ZipFileExtensions]::ExtractToFile($e, (Join-Path $root "runtime\$f"), $true)
}
$z.Dispose()
Write-Output "Готово: runtime\node.exe ($ver), контрольная сумма совпала."
