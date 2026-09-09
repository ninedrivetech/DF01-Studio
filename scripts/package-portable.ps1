$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Use npm run package:portable on Linux; this PowerShell implementation packages Windows only.' }
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$version = $manifest.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Expected a numeric release version.' }
$outputDirectory = Join-Path $projectRoot 'release'
$stagingDirectory = Join-Path $outputDirectory 'portable-docs'
$docsDirectory = Join-Path $stagingDirectory 'docs'
$executable = Join-Path $projectRoot 'src-tauri\target\release\df01-studio.exe'
$tauriDirectory = Join-Path $projectRoot 'src-tauri'
$tauriConfig = Get-Content -LiteralPath (Join-Path $tauriDirectory 'tauri.conf.json') -Encoding UTF8 -Raw | ConvertFrom-Json
$installer = Join-Path $projectRoot ("src-tauri\target\release\bundle\nsis\{0}_{1}_x64-setup.exe" -f $tauriConfig.productName, $version)
foreach ($artifact in @($executable, $installer)) {
    if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) { throw "Missing build artifact: $artifact" }
}
$resolvedStaging = [System.IO.Path]::GetFullPath($stagingDirectory)
$expectedStaging = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'release\portable-docs'))
if ($resolvedStaging -ne $expectedStaging -or -not $resolvedStaging.StartsWith($projectRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe staging directory.' }
if (Test-Path -LiteralPath $resolvedStaging) {
    if ((Get-Item -LiteralPath $resolvedStaging -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Staging directory must not be a link.' }
    Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
}
New-Item -ItemType Directory -Path $docsDirectory -Force | Out-Null
foreach ($resource in $tauriConfig.bundle.resources.PSObject.Properties) {
    if (-not $resource.Value.StartsWith('docs/')) { continue }
    $source = [System.IO.Path]::GetFullPath((Join-Path $tauriDirectory $resource.Name))
    $destination = [System.IO.Path]::GetFullPath((Join-Path $stagingDirectory $resource.Value))
    if (-not $source.StartsWith($projectRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Resource source escapes the project.' }
    if (-not $destination.StartsWith($docsDirectory + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Resource destination escapes the package.' }
    Copy-Item -LiteralPath $source -Destination $destination -Force
}
$readme = Join-Path $projectRoot 'README.md'
$notices = Join-Path $projectRoot 'THIRD-PARTY-NOTICES.txt'
$archive = Join-Path $outputDirectory "DF-01-${version}-portable.zip"
$pendingArchive = Join-Path $outputDirectory "DF-01-${version}-portable.new.zip"
Compress-Archive -LiteralPath @($executable, $readme, $notices, $docsDirectory) -DestinationPath $pendingArchive -Force
$installerCopy = Join-Path $outputDirectory "DF-01-${version}-x64-setup.exe"
Copy-Item -LiteralPath $installer -Destination $installerCopy -Force
try {
    if (Test-Path -LiteralPath $archive -PathType Leaf) {
        [System.IO.File]::Replace($pendingArchive, $archive, [System.Management.Automation.Language.NullString]::Value)
    } else {
        Move-Item -LiteralPath $pendingArchive -Destination $archive
    }
} catch {
    throw "Cannot replace $archive. Close any application using the archive and retry. The complete new archive remains at $pendingArchive. $($_.Exception.Message)"
}
Get-Item -LiteralPath $installerCopy, $archive | Select-Object FullName, Length
$checksums = foreach ($artifact in @($installerCopy, $archive)) {
    $stream = [System.IO.File]::OpenRead($artifact)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = [System.BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '')
        '{0}  {1}' -f $hash, [System.IO.Path]::GetFileName($artifact)
    } finally {
        $stream.Dispose()
        $sha256.Dispose()
    }
}
$checksums | Set-Content -LiteralPath (Join-Path $outputDirectory 'SHA256SUMS.txt') -Encoding ASCII
$checksums
