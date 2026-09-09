$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourceIcon = Join-Path $projectRoot 'src\assets\df01-icon.svg'
$tauriCli = Join-Path $projectRoot 'node_modules\@tauri-apps\cli\tauri.js'
$iconDirectory = Join-Path $PSScriptRoot 'icons'
& node $tauriCli icon $sourceIcon --output $iconDirectory
if ($LASTEXITCODE -ne 0) { throw 'DF-01 icon generation failed.' }
