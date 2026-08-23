#Requires -Version 5.1

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$principal = [Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent()
)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Ejecuta este script desde PowerShell como Administrador.'
}

$portRange = '54620-54629'
$dockerBackend = Get-Process -Name 'com.docker.backend' -ErrorAction SilentlyContinue |
    Where-Object { $_.Path } |
    Select-Object -First 1
if (-not $dockerBackend) {
    throw 'No se encontró com.docker.backend.exe; inicia Docker Desktop antes de instalar las reglas.'
}
$dockerBackendPath = $dockerBackend.Path

$rules = @(
    [pscustomobject]@{
        DisplayName = 'Crimson Crown Local Supabase - Block IPv4 Non-Loopback'
        Description = 'Blocks IPv4 non-loopback access to Crimson Crown local Supabase.'
        ProgramPath = $null
        RemoteAddress = @(
            '0.0.0.0-126.255.255.255',
            '128.0.0.0-255.255.255.255'
        )
    },
    [pscustomobject]@{
        DisplayName = 'Crimson Crown Local Supabase - Block IPv6'
        Description = 'Blocks IPv6 access to Crimson Crown local Supabase.'
        ProgramPath = $null
        RemoteAddress = @(
            '::/1',
            '8000::/1'
        )
    },
    [pscustomobject]@{
        DisplayName = 'Crimson Crown Local Supabase - Docker Backend Block IPv4 Non-Loopback'
        Description = 'Blocks Docker Desktop backend IPv4 non-loopback access to Crimson Crown local Supabase.'
        ProgramPath = $dockerBackendPath
        RemoteAddress = @(
            '0.0.0.0-126.255.255.255',
            '128.0.0.0-255.255.255.255'
        )
    },
    [pscustomobject]@{
        DisplayName = 'Crimson Crown Local Supabase - Docker Backend Block IPv6'
        Description = 'Blocks Docker Desktop backend IPv6 access to Crimson Crown local Supabase.'
        ProgramPath = $dockerBackendPath
        RemoteAddress = @(
            '::/1',
            '8000::/1'
        )
    }
)

function ConvertTo-NormalizedAddressList {
    param([string[]]$Address)

    return (($Address | ForEach-Object { $_.ToLowerInvariant() } | Sort-Object) -join ',')
}

foreach ($specification in $rules) {
    $existing = @(Get-NetFirewallRule -DisplayName $specification.DisplayName -ErrorAction SilentlyContinue)

    if ($existing.Count -gt 1) {
        throw "Hay más de una regla con el nombre esperado: $($specification.DisplayName)"
    }

    if ($existing.Count -eq 1) {
        $rule = $existing[0]
        $portFilter = $rule | Get-NetFirewallPortFilter
        $addressFilter = $rule | Get-NetFirewallAddressFilter
        $actualAddresses = ConvertTo-NormalizedAddressList @($addressFilter.RemoteAddress)
        $expectedAddresses = ConvertTo-NormalizedAddressList @($specification.RemoteAddress)
        $protocolIsTcp = [string]$portFilter.Protocol -in @('TCP', '6')
        $programMatches = $true
        if ($specification.ProgramPath) {
            $applicationFilter = $rule | Get-NetFirewallApplicationFilter
            $programMatches = [string]$applicationFilter.Program -ieq $specification.ProgramPath
        }
        $matches = (
            $rule.Enabled -eq 'True' -and
            $rule.Direction -eq 'Inbound' -and
            $rule.Action -eq 'Block' -and
            $protocolIsTcp -and
            [string]$portFilter.LocalPort -eq $portRange -and
            $actualAddresses -eq $expectedAddresses -and
            $programMatches
        )

        if (-not $matches) {
            throw "La regla existente no coincide con la configuración segura esperada: $($specification.DisplayName)"
        }

        continue
    }

    $parameters = @{
        DisplayName = $specification.DisplayName
        Description = $specification.Description
        Direction = 'Inbound'
        Action = 'Block'
        Protocol = 'TCP'
        LocalPort = $portRange
        RemoteAddress = $specification.RemoteAddress
        Profile = 'Any'
        Enabled = 'True'
        EdgeTraversalPolicy = 'Block'
        PolicyStore = 'PersistentStore'
    }
    if ($specification.ProgramPath) {
        $parameters.Program = $specification.ProgramPath
    }
    New-NetFirewallRule @parameters | Out-Null
}

Write-Output 'Reglas de aislamiento local de Crimson instaladas y verificadas.'
