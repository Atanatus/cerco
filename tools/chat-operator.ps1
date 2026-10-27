# Windows operator console. Never prints the moderation secret or puts it in arguments.
[CmdletBinding()]
param(
    [ValidateSet('Provision', 'List', 'Delete', 'Ban', 'Pause', 'Resume')]
    [string]$Action = 'List',
    [string]$Id,
    [switch]$Apply
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This vault requires Windows DPAPI and the same Windows user.' }
if ($Action -ne 'List' -and -not $Apply) { throw 'Writes require -Apply and explicit production authorization.' }
if ($Action -in @('Delete', 'Ban') -and $Id -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') {
    throw 'Provide a message UUID for Delete or a participant UUID for Ban.'
}
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$vault = Join-Path $env:LOCALAPPDATA 'CERCO/chat-moderation.dpapi'
if ([IO.Path]::GetFullPath($vault).StartsWith($repo, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The encrypted vault must be outside the repository.'
}
if (-not (Test-Path -LiteralPath $vault)) {
    if ($Action -ne 'Provision') { throw 'Provision first from this Windows account after production approval.' }
    $bytes = [byte[]]::new(48)
    [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $secure = ConvertTo-SecureString ([Convert]::ToBase64String($bytes)) -AsPlainText -Force
    [Array]::Clear($bytes)
    New-Item -ItemType Directory -Path (Split-Path $vault) -Force | Out-Null
    ConvertFrom-SecureString $secure | Set-Content -LiteralPath $vault -NoNewline
} else {
    $secure = Get-Content -LiteralPath $vault -Raw | ConvertTo-SecureString
}
$pointer = [IntPtr]::Zero
$previousToken = $env:CERCO_CHAT_MODERATION_TOKEN
$previousLog = $env:WRANGLER_LOG_PATH
$previousMetrics = $env:WRANGLER_SEND_METRICS
$previousWriteLogs = $env:WRANGLER_WRITE_LOGS
$previousSanitize = $env:WRANGLER_LOG_SANITIZE
$previousLevel = $env:WRANGLER_LOG
try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ($Action -eq 'Provision') {
        # Reusing an existing vault retries installation without rotating the key.
        $logDir = Join-Path $repo '.local-recovery/op38'
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        $env:WRANGLER_LOG_PATH = Join-Path $logDir 'secret-install.log'
        $env:WRANGLER_SEND_METRICS = 'false'
        $env:WRANGLER_WRITE_LOGS = 'false'
        $env:WRANGLER_LOG_SANITIZE = 'true'
        $env:WRANGLER_LOG = 'error'
        $result = $token | & wrangler.cmd secret put CHAT_MODERATION_TOKEN --config (Join-Path $repo 'backend/worker/wrangler.jsonc') 2>&1
        if ($LASTEXITCODE -ne 0) { throw 'Secret installation failed. Encrypted vault retained; retry Provision. Secret and raw output withheld.' }
        Write-Output 'Moderation secret installed. Chat remains gated; verify deployment and List before activation.'
    } else {
        $env:CERCO_CHAT_MODERATION_TOKEN = $token
        $arguments = @((Join-Path $repo 'tools/moderate-chat.mjs'), $Action.ToLowerInvariant())
        if ($Action -in @('Delete', 'Ban')) { $arguments += $Id }
        if ($Apply) { $arguments += '--apply' }
        & node @arguments
        if ($LASTEXITCODE -ne 0) { throw 'Moderation failed; check authentication and service status.' }
    }
} finally {
    $env:CERCO_CHAT_MODERATION_TOKEN = $previousToken
    $env:WRANGLER_LOG_PATH = $previousLog
    $env:WRANGLER_SEND_METRICS = $previousMetrics
    $env:WRANGLER_WRITE_LOGS = $previousWriteLogs
    $env:WRANGLER_LOG_SANITIZE = $previousSanitize
    $env:WRANGLER_LOG = $previousLevel
    $token = $null; $result = $null
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    $secure.Dispose()
}
