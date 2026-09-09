param(
    [ValidateSet('debug', 'release')][string]$Configuration = 'debug',
    [ValidateRange(1024, 65535)][int]$Port = 9223,
    [ValidateRange(5, 60)][int]$StartupTimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'This native smoke test requires Windows WebView2. Use npm run test:e2e for Linux browser tests.' }
$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$executable = Join-Path $workspace "src-tauri\target\$Configuration\df01-studio.exe"
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "Build the $Configuration executable before running the native smoke test."
}
$node = (Get-Command node -ErrorAction Stop).Source
if ($Configuration -eq 'debug') {
    $devResponse = Invoke-WebRequest -Uri 'http://127.0.0.1:1420/' -UseBasicParsing -TimeoutSec 5
    if ($devResponse.StatusCode -ne 200) { throw 'The Vite server must be running at http://127.0.0.1:1420/.' }
}

# Refuse to attach to a CDP listener belonging to another application.
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
try { $listener.Start() } catch { throw "Port $Port is already occupied. Select a free port with -Port." } finally { $listener.Stop() }

$previousArguments = [Environment]::GetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', 'Process')
$previousDataFolder = [Environment]::GetEnvironmentVariable('WEBVIEW2_USER_DATA_FOLDER', 'Process')
$temporaryName = 'df01-native-smoke-' + [guid]::NewGuid().ToString('N')
$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$userDataFolder = [System.IO.Path]::GetFullPath((Join-Path $temporaryRoot $temporaryName))
[System.IO.Directory]::CreateDirectory($userDataFolder) | Out-Null
$nativeProcess = $null
$testExitCode = 1

try {
    [Environment]::SetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', "--remote-debugging-port=$Port", 'Process')
    [Environment]::SetEnvironmentVariable('WEBVIEW2_USER_DATA_FOLDER', $userDataFolder, 'Process')
    $nativeProcess = Start-Process -FilePath $executable -WorkingDirectory $workspace -WindowStyle Hidden -PassThru
    $launchedAt = $nativeProcess.StartTime
    Write-Output "Started isolated DF-01 Studio PID $($nativeProcess.Id), CDP port $Port."
    $deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
    $ready = $false
    while ([DateTime]::UtcNow -lt $deadline) {
        $nativeProcess.Refresh()
        if ($nativeProcess.HasExited) { throw "DF-01 Studio exited before WebView2 was ready, exit code $($nativeProcess.ExitCode)." }
        try {
            $version = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 1
            if ($version.webSocketDebuggerUrl) { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 200 }
    }
    if (-not $ready) { throw 'Timed out waiting for the isolated WebView2 debug endpoint.' }
    & $node (Join-Path $PSScriptRoot 'native-smoke.mjs') "--port=$Port" "--pid=$($nativeProcess.Id)" "--configuration=$Configuration"
    $testExitCode = $LASTEXITCODE
    if ($testExitCode -eq 0) {
        if (-not $nativeProcess.WaitForExit(5000)) { throw 'The topbar close button did not terminate its native host process.' }
        Write-Output 'Verified topbar close terminated the owned native host process.'
    }
} finally {
    [Environment]::SetEnvironmentVariable('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', $previousArguments, 'Process')
    [Environment]::SetEnvironmentVariable('WEBVIEW2_USER_DATA_FOLDER', $previousDataFolder, 'Process')
    if ($nativeProcess) {
        $ownedProcess = Get-Process -Id $nativeProcess.Id -ErrorAction SilentlyContinue
        if ($ownedProcess -and $ownedProcess.StartTime -eq $launchedAt) {
            Stop-Process -Id $nativeProcess.Id -Force
            Write-Output "Stopped owned DF-01 Studio PID $($nativeProcess.Id)."
        }
        $nativeProcess.Dispose()
    }
    $resolvedFolder = [System.IO.Path]::GetFullPath($userDataFolder)
    if ($resolvedFolder.StartsWith($temporaryRoot, [System.StringComparison]::OrdinalIgnoreCase) -and [System.IO.Path]::GetFileName($resolvedFolder) -eq $temporaryName) {
        for ($cleanupAttempt = 0; $cleanupAttempt -lt 10; $cleanupAttempt++) {
            try {
                if (Test-Path -LiteralPath $resolvedFolder) { Remove-Item -LiteralPath $resolvedFolder -Recurse -Force -ErrorAction Stop }
                break
            } catch {
                if ($cleanupAttempt -eq 9) { Write-Warning "Temporary WebView2 profile remains at $resolvedFolder because files are still in use." }
                else { Start-Sleep -Milliseconds 200 }
            }
        }
    }
}

exit $testExitCode
