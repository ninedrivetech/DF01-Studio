param([string]$ProjectRoot = (Join-Path $PSScriptRoot '..'))
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'This script packages Windows only.' }
Add-Type -AssemblyName System.IO.Compression
$projectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$version = $manifest.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Expected a numeric release version.' }
$tauriDirectory = Join-Path $projectRoot 'src-tauri'
$config = Get-Content -LiteralPath (Join-Path $tauriDirectory 'tauri.conf.json') -Encoding UTF8 -Raw | ConvertFrom-Json
if ($config.version -ne $version) { throw 'Package and Tauri versions differ.' }

function Assert-Contained([string]$Root, [string]$Target) {
    $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    $targetPath = [IO.Path]::GetFullPath($Target)
    if (-not $targetPath.StartsWith($rootPath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Path escapes project: $Target" }
    $cursor = $targetPath
    while ($cursor -and $cursor -ne $rootPath) {
        if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Package path must not be a link: $cursor" }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
    return $targetPath
}
function Get-StreamHash([IO.Stream]$Stream) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($Stream)).Replace('-', '') }
    finally { $sha.Dispose() }
}
$entries = [ordered]@{ 'df01-studio.exe' = (Join-Path $tauriDirectory 'target\release\df01-studio.exe') }
foreach ($resource in $config.bundle.resources.PSObject.Properties) {
    $name = [string]$resource.Value
    if ($name -match '(^/|\\|:|(^|/)\.\.?(/|$)|/$)' -or [string]::IsNullOrWhiteSpace($name)) { throw "Unsafe archive destination: $name" }
    if ($entries.Contains($name)) { throw "Duplicate archive destination: $name" }
    $entries[$name] = Join-Path $tauriDirectory $resource.Name
}
foreach ($name in @($entries.Keys)) {
    $source = Assert-Contained $projectRoot $entries[$name]
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing build artifact or resource: $source" }
    $entries[$name] = $source
}
$outputDirectory = Assert-Contained $projectRoot (Join-Path $projectRoot 'release')
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$archive = Assert-Contained $projectRoot (Join-Path $outputDirectory "DF-01-${version}-portable.zip")
$checksum = Assert-Contained $projectRoot (Join-Path $outputDirectory 'SHA256SUMS.txt')
$pending = Join-Path $outputDirectory ('.portable-' + [Guid]::NewGuid().ToString('N') + '.zip')
$stream = [IO.File]::Open($pending, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
$zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $true)
$expected = @{}
try {
    foreach ($name in $entries.Keys) {
        $input = [IO.File]::OpenRead($entries[$name])
        $entry = $zip.CreateEntry($name, [IO.Compression.CompressionLevel]::Optimal)
        $output = $entry.Open()
        try {
            $expected[$name] = Get-StreamHash $input
            $input.Position = 0
            $input.CopyTo($output)
        } finally { $output.Dispose(); $input.Dispose() }
    }
} finally { $zip.Dispose(); $stream.Dispose() }
$stream = [IO.File]::OpenRead($pending)
$zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Read)
try {
    if ($zip.Entries.Count -ne $expected.Count) { throw 'Archive entry count differs.' }
    foreach ($entry in $zip.Entries) {
        $input = $entry.Open()
        try { if ((Get-StreamHash $input) -ne $expected[$entry.FullName]) { throw "Archive verification failed: $($entry.FullName)" } }
        finally { $input.Dispose() }
    }
} finally { $zip.Dispose(); $stream.Dispose() }
try {
    if (Test-Path -LiteralPath $archive) {
        [IO.File]::Replace($pending, $archive, [System.Management.Automation.Language.NullString]::Value)
    } else { [IO.File]::Move($pending, $archive) }
} catch { throw "Cannot replace $archive. Verified new archive remains at $pending. $($_.Exception.Message)" }
$stream = [IO.File]::OpenRead($archive)
try { $hash = Get-StreamHash $stream } finally { $stream.Dispose() }
"$hash  $([IO.Path]::GetFileName($archive))" | Set-Content -LiteralPath $checksum -Encoding ASCII
Get-Item -LiteralPath $archive | Select-Object FullName, Length
Write-Output "Verified $($expected.Count) entries. SHA256: $hash"
