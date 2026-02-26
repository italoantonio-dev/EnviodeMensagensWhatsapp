$ErrorActionPreference = 'Stop'

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Push-Location $projectRoot

try {
  $regex = 'bot\.js|npm-cli\.js"\s+(run\s+_startbot|start|run\s+start)'
  $processos = Get-CimInstance Win32_Process |
    Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match $regex }

  foreach ($processo in $processos) {
    Stop-Process -Id $processo.ProcessId -Force -ErrorAction SilentlyContinue
  }

  Write-Output "Processos finalizados: $($processos.Count)"

  . "$PSScriptRoot\use-node20.ps1"
  npm run _startbot
}
finally {
  Pop-Location
}
