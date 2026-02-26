function Get-FnmPath {
  $base = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
  if (!(Test-Path $base)) {
    throw 'fnm não encontrado. Instale com: winget install Schniz.fnm --scope user'
  }

  $fnmExe = Get-ChildItem $base -Directory -Filter 'Schniz.fnm*' -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName 'fnm.exe' } |
    Where-Object { Test-Path $_ } |
    Select-Object -First 1

  if (!$fnmExe) {
    throw 'fnm.exe não encontrado na instalação do WinGet.'
  }

  return $fnmExe
}

$fnmPath = Get-FnmPath
$envScript = ((& $fnmPath env --shell powershell) -join "`n")
Invoke-Expression $envScript
& $fnmPath use 20 | Out-Null
