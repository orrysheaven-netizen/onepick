# Read-only. No account creation, ACL changes, credential reads or model calls.
param([Parameter(Mandatory=$true)][string]$PolicyPath,
      [Parameter(Mandatory=$true)][string]$ApprovalPath)
$ErrorActionPreference = 'Stop'
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'admin-worker' }
    $policy = Get-Content -LiteralPath $PolicyPath -Raw | ConvertFrom-Json
    if ($identity.User.Value -ne $policy.worker_sid) { throw 'wrong-worker' }
    if ($policy.worker_sid -eq $policy.controller_sid -or $policy.controller_sid -notmatch '^S-1-5-21-') { throw 'sid-separation' }
    # This first adapter supports no endpoint-managed customizations. Never execute a policy helper.
    foreach ($path in @('C:\Program Files\ClaudeCode\managed-settings.json',
                        'C:\Program Files\ClaudeCode\managed-settings.d',
                        'C:\Program Files\ClaudeCode\managed-mcp.json')) {
        if (Test-Path -LiteralPath $path) { throw 'managed-settings-not-supported' }
    }
    foreach ($path in @('HKLM:\SOFTWARE\Policies\ClaudeCode', 'HKCU:\SOFTWARE\Policies\ClaudeCode')) {
        if (Test-Path -LiteralPath $path) { throw 'registry-settings-not-supported' }
    }
    $admins = @('S-1-5-18', 'S-1-5-32-544')
    $writeMask = [int64]([Security.AccessControl.FileSystemRights]::Write -bor
        [Security.AccessControl.FileSystemRights]::Delete -bor
        [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [Security.AccessControl.FileSystemRights]::TakeOwnership)
    function Assert-Protected([string]$candidate) {
        $item = Get-Item -LiteralPath $candidate -Force
        while ($null -ne $item) {
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'reparse-path' }
            $acl = Get-Acl -LiteralPath $item.FullName
            $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
            if ($owner -notin $admins) { throw 'untrusted-owner' }
            foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
                if ($rule.AccessControlType -eq 'Allow' -and
                    $rule.IdentityReference.Value -notin $admins -and
                    (([int64]$rule.FileSystemRights -band $writeMask) -ne 0)) { throw 'writable-trust-path' }
            }
            # Root drive ACL is an installation trust assumption; every directory below it is checked.
            $parent = if ($item.PSIsContainer) { $item.Parent } else { $item.Directory }
            if ($null -eq $parent -or $null -eq $parent.Parent) { break }
            $item = $parent
        }
    }
    Assert-Protected $PolicyPath
    Assert-Protected $ApprovalPath
    Assert-Protected $policy.cli_path
    Assert-Protected $PSCommandPath
    Assert-Protected (Join-Path $PSScriptRoot 'adapter.py')
    $spool = Get-Item -LiteralPath $policy.spool -Force
    if (($spool.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'spool-reparse' }
    Assert-Protected $spool.Parent.FullName
    $acl = Get-Acl -LiteralPath $spool.FullName
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin ($admins + $policy.worker_sid)) { throw 'spool-owner' }
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin ($admins + $policy.worker_sid)) { throw 'spool-access' }
    }
    # The managed-settings audit is separately approved at deployment. This script never reads secrets.
    Write-Output 'verified'
    exit 0
} catch {
    # Suppress paths, identities and arbitrary exception contents.
    Write-Output 'unverified'
    exit 1
}
