[CmdletBinding()]
param(
  [ValidateSet('VerifyOnly', 'Apply')]
  [string]$Mode = 'VerifyOnly',
  [switch]$ApplyToStaging,
  [string]$SupabaseCli = '',
  [string]$NodeExecutable = $(if ($env:npm_node_execpath) { $env:npm_node_execpath } else { 'node' }),
  [string]$BaselinePath = $(Join-Path $env:LOCALAPPDATA 'CrimsonCrown\supabase-mirror\raw\schema.sql'),
  [string]$EvidenceDirectory = 'local-artifacts\release-evidence\staging-p0'
)

$ErrorActionPreference = 'Stop'
$ExpectedStagingRef = 'ssyeqgtdohwkcucedpwx'
$ExpectedCliVersion = '2.113.0'
$ScriptDirectory = Split-Path -Parent $PSCommandPath
$AppRoot = [IO.Path]::GetFullPath((Join-Path $ScriptDirectory '..\..'))
$SnapshotSql = Join-Path $ScriptDirectory 'snapshot-crimson-schema.sql'

$SourceLedger = @(
  [pscustomobject]@{ Class = 'baseline'; Path = $BaselinePath; Sha256 = 'b794231bad902acae1ae8220a54e56c85f00422ee14e7898eca0da8664fb6eb3' },
  [pscustomobject]@{ Class = 'production'; Path = (Join-Path $AppRoot 'supabase\migrations\20260826120000_production_runtime_functions.sql'); Sha256 = '1495f5ccbd382224fa5c28312ecc488f29ad8bd680020dda73e9f68a183388f3' },
  [pscustomobject]@{ Class = 'production'; Path = (Join-Path $AppRoot 'supabase\migrations\20260826121500_revoke_is_admin_anon.sql'); Sha256 = '9ccca376f02452f82481037f25646b1fc47812dd3e1966437f0fa8e0784dddcd' },
  [pscustomobject]@{ Class = 'production'; Path = (Join-Path $AppRoot 'supabase\migrations\20260827020755_create_multi_inventory_system.sql'); Sha256 = '71f827c3d33fad843e1324fa4566be56d662c27d9da9e0f781eaacfa418a0080' },
  [pscustomobject]@{ Class = 'production'; Path = (Join-Path $AppRoot 'supabase\migrations\20260827020830_multi_inventory_runtime_functions.sql'); Sha256 = '0ec9d9c609d0cd30f9bf0d3089f983a2cf4d2dea5ef4a641594e5df38b801210' },
  [pscustomobject]@{ Class = 'production'; Path = (Join-Path $AppRoot 'supabase\migrations\20260827024000_add_external_prices_name_search_index.sql'); Sha256 = '3deec1275e2079c80c5f0c5782c2b8580ee17433f28cb4ff21e998a70f1be39f' },
  [pscustomobject]@{ Class = 'forward'; Path = (Join-Path $AppRoot 'supabase\migrations\20260829021742_admin_product_mutations.sql'); Sha256 = '52d24ebf8abe6727df7da45ca723d8226f7aa433e3ef527aef7b598376187112' },
  [pscustomobject]@{ Class = 'forward'; Path = (Join-Path $AppRoot 'supabase\migrations\20260829183155_harden_privileged_surfaces.sql'); Sha256 = 'c7c72ae2ef51ec9c6be0998d1782f29d55dd49b3295f776c49c08244e25615ce' },
  [pscustomobject]@{ Class = 'forward'; Path = (Join-Path $AppRoot 'supabase\migrations\20260829213332_add_payment_proof_paths.sql'); Sha256 = 'fe730e4ea18664a490ef6016f1e1584c503a1a25d890d425d11b4e066d635653' },
  [pscustomobject]@{ Class = 'forward'; Path = (Join-Path $AppRoot 'supabase\migrations\20260829224424_finalize_import_quotes_atomically.sql'); Sha256 = '2eced781fe279001938980a3bbeb63c8e3dd3fd079301637f971614095aa7cd9' },
  [pscustomobject]@{ Class = 'forward'; Path = (Join-Path $AppRoot 'supabase\migrations\20260829231011_freeze_approved_import_quote_items.sql'); Sha256 = '96925b88a1b1935fe24aacc6ef7263dd2404f000568eb795be86727e20f19216' },
  [pscustomobject]@{ Class = 'forward'; Path = (Join-Path $AppRoot 'supabase\migrations\20260829232257_fix_import_item_guard_rls.sql'); Sha256 = 'cda5780cdcc37be43898fc771d9f9e56dbbd6d84176db094e3a469a52f69a415' },
  [pscustomobject]@{ Class = 'forward'; Path = (Join-Path $AppRoot 'supabase\migrations\20260829235000_report_commission_payment_atomically.sql'); Sha256 = '639fc667dd1b802096189268b978f29e9746c90671d758f991233a50d78672c1' },
  [pscustomobject]@{ Class = 'forward'; Path = (Join-Path $AppRoot 'supabase\migrations\20260829235500_confirm_commission_payment_atomically.sql'); Sha256 = 'd2dc149d1b35ebf7edda299a7db59c6381c78c0876c450df8856616606aabbcc' },
  [pscustomobject]@{ Class = 'forward'; Path = (Join-Path $AppRoot 'supabase\migrations\20260829235700_fix_commission_payment_proof_path_regex.sql'); Sha256 = 'c0a41ec56d31e85e5f3c7017eb7a4d9e2a7a1aea8bc08e3eaa614fb66241f9f8' },
  [pscustomobject]@{ Class = 'forward'; Path = (Join-Path $AppRoot 'supabase\migrations\20260829235800_reconcile_legacy_schema_safely.sql'); Sha256 = 'feff9a68c4bd35d7eb04e30c85b980b7e7b5863e0706570651a1ca8647e511de' },
  [pscustomobject]@{ Class = 'storage'; Path = (Join-Path $AppRoot 'supabase\migrations\20260829235900_harden_storage_buckets_and_policies.sql'); Sha256 = 'b2749b0a319f2f3ef058354d52c3961a3196837d757c6f37a6841c9da644579c' },
  [pscustomobject]@{ Class = 'staging-only'; Path = (Join-Path $AppRoot 'scripts\staging\sql\scope-staging-commission-operator.sql'); Sha256 = '28ca719e8ba88c48f399ff9f9b0534bff27928df922cd2b6e77e6fc861de73ff' }
)

$RemoteLedger = @(
  [pscustomobject]@{ Version = '20260830002923'; Name = 'production_schema_baseline_20260829'; Sha256 = 'c3ff23cd631e89e5124dd0f2cba6d389d760183838b82c35accbe4a1c8cf7e66' },
  [pscustomobject]@{ Version = '20260830002956'; Name = 'production_runtime_functions'; Sha256 = '728a2ff87787d7dd4637159492c163143e0a15206fc0c6e9f072d058a9ed4093' },
  [pscustomobject]@{ Version = '20260830003002'; Name = 'revoke_is_admin_anon'; Sha256 = '89a4cfdc2b7399cbf9aa4ce36919dc3db0f57e14f3ae0e1709bc18ee96f32ae2' },
  [pscustomobject]@{ Version = '20260830003009'; Name = 'create_multi_inventory_system'; Sha256 = '757cac5ae425453787aee2bbba67d884837b4bca66825e65c60cfdc6d736c485' },
  [pscustomobject]@{ Version = '20260830003018'; Name = 'multi_inventory_runtime_functions'; Sha256 = '33f0e6e37cca7658c6775b2258b98a29c52a7ac128ec8f6ddb29808fc6288289' },
  [pscustomobject]@{ Version = '20260830003025'; Name = 'add_external_prices_name_search_index'; Sha256 = '94ced8537442c5afca9c270a7362c6a983cc1017681d57c909ba252565e74e24' },
  [pscustomobject]@{ Version = '20260830003041'; Name = 'admin_product_mutations'; Sha256 = '7cd95bd263feef103974fec28060df9ec8a5c55181ca8e21ca5d9f232e0ed273' },
  [pscustomobject]@{ Version = '20260830003047'; Name = 'harden_privileged_surfaces'; Sha256 = '852994bf0c3563fd0417e64fe485c19d7942a92bd9b587feb73a462a73c79478' },
  [pscustomobject]@{ Version = '20260830003053'; Name = 'add_payment_proof_paths'; Sha256 = 'a11bb8935d5bcb3d268b6f8cc3c9e341bffd0815d0842625b10222e5b185dc6e' },
  [pscustomobject]@{ Version = '20260830003100'; Name = 'finalize_import_quotes_atomically'; Sha256 = '287b0b1c8f2184cf7ae5329967c6f935f7c79766f44a426e250c5c8ba9ea426d' },
  [pscustomobject]@{ Version = '20260830003106'; Name = 'freeze_approved_import_quote_items'; Sha256 = '1d2c4ff3c6a5079f37309ab34b3ac415b47bb6a82c6277505ae6cfe6905b14fb' },
  [pscustomobject]@{ Version = '20260830003113'; Name = 'fix_import_item_guard_rls'; Sha256 = '6461df90e0745dbbd6f11e6777d2437aabba3f2248fb13a592b4b1f39c7c4220' },
  [pscustomobject]@{ Version = '20260830004907'; Name = 'harden_storage_buckets_and_policies'; Sha256 = '30ed7942c176e0d6e781d7f73f33be714014d312023dd47764466a34fc0ca811' },
  [pscustomobject]@{ Version = '20260830012837'; Name = 'scope_staging_commission_operator'; Sha256 = '4a9d1475cf9375ae02d009ddbddf4b9f290617c262e12e234a53ab59130fac9f' },
  [pscustomobject]@{ Version = '20260830030639'; Name = 'report_commission_payment_atomically'; Sha256 = '90797543348a079d528561ff1f8ad55902ee6ddc02e1d3dd8942fb13c2bb827b' },
  [pscustomobject]@{ Version = '20260830031656'; Name = 'confirm_commission_payment_atomically'; Sha256 = '5cb3aa5a8d2efd28a4d47e467653feb00993d02d27e20ea6d5a4a089813e611b' },
  [pscustomobject]@{ Version = '20260830033321'; Name = 'fix_commission_payment_proof_path_regex'; Sha256 = '114647ad0d1b465c7a4a654080873e33061495085caf2867073b95b3ef6dd7f6' },
  [pscustomobject]@{ Version = '20260830041919'; Name = 'reconcile_legacy_schema_safely'; Sha256 = '616bc1907f3901cd6f37e88d9dfe3f5dc11ec09644f9094fd168cf31394adf5a' },
  [pscustomobject]@{ Version = '20260830043020'; Name = 'reconcile_legacy_schema_safely_transactional'; Sha256 = 'ba28412950740ca5ae53020f46fd2d4310d9db4857e1ce35a13ff90077aa3f4a' }
)

function Stop-UnsafeStaging {
  throw 'Crimson staging no autorizado.'
}

function Assert-ExactEnvironment {
  if ($Mode -eq 'Apply' -and -not $ApplyToStaging) { throw 'Apply requiere -ApplyToStaging.' }
  if ($Mode -ne 'Apply' -and $ApplyToStaging) { throw '-ApplyToStaging sólo es válido con -Mode Apply.' }
  if (
    $env:CRIMSON_STAGING_SUPABASE_PROJECT_REF -ne $ExpectedStagingRef -or
    $env:NEXT_PUBLIC_CRIMSON_STAGING_SUPABASE_PROJECT_REF -ne $ExpectedStagingRef -or
    $env:NEXT_PUBLIC_SUPABASE_URL -ne "https://$ExpectedStagingRef.supabase.co" -or
    $env:NEXT_PUBLIC_CRIMSON_DEPLOYMENT_TARGET -ne 'staging' -or
    $env:DISABLE_EXTERNAL_SIDE_EFFECTS -ne 'true' -or
    $env:CRIMSON_STAGING_EMAIL_DOMAIN -ne 'example.test'
  ) {
    Stop-UnsafeStaging
  }
  if (-not $env:PLAYWRIGHT_BASE_URL -or $env:PLAYWRIGHT_BASE_URL -match 'crimsoncrownimports[.]com') {
    Stop-UnsafeStaging
  }
  foreach ($entry in Get-ChildItem Env:) {
    if ($entry.Value -and $entry.Name -match '(?:RESEND|MERCADO_?PAGO|^MP_|WEBHOOK)') {
      Stop-UnsafeStaging
    }
  }
}

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = @(& $Executable @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($exitCode -ne 0) { throw $FailureMessage }
  return ($output -join "`n").Trim()
}

function Assert-SourceLedger {
  foreach ($entry in $SourceLedger) {
    if (-not (Test-Path -LiteralPath $entry.Path -PathType Leaf)) {
      throw 'Fuente local requerida ausente.'
    }
    $stream = [System.IO.File]::OpenRead($entry.Path)
    try {
      $sha256 = [System.Security.Cryptography.SHA256]::Create()
      try {
        $actual = -join ($sha256.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') })
      }
      finally {
        $sha256.Dispose()
      }
    }
    finally {
      $stream.Dispose()
    }
    if ($actual -ne $entry.Sha256) { throw 'El hash local no coincide.' }
  }
  if (
    @($SourceLedger | Where-Object Class -eq 'baseline').Count -ne 1 -or
    @($SourceLedger | Where-Object Class -eq 'production').Count -ne 5 -or
    @($SourceLedger | Where-Object Class -eq 'forward').Count -ne 10 -or
    @($SourceLedger | Where-Object Class -eq 'storage').Count -ne 1 -or
    @($SourceLedger | Where-Object Class -eq 'staging-only').Count -ne 1
  ) {
    throw 'El conjunto local no coincide.'
  }
}

function ConvertTo-Snapshot {
  param([Parameter(Mandatory = $true)][string]$RawOutput)
  $objectStart = $RawOutput.IndexOf('{')
  $arrayStart = $RawOutput.IndexOf('[')
  $jsonStart = if ($objectStart -lt 0) {
    $arrayStart
  } elseif ($arrayStart -lt 0) {
    $objectStart
  } else {
    [Math]::Min($objectStart, $arrayStart)
  }
  if ($jsonStart -lt 0) { throw 'Snapshot remoto no verificable.' }

  $candidate = $RawOutput.Substring($jsonStart).Trim()
  try {
    $parsed = $candidate | ConvertFrom-Json
  } catch {
    throw 'Snapshot remoto no verificable.'
  }
  if ($parsed -is [array]) { $parsed = $parsed[0] }
  if ($parsed.snapshot) { return $parsed.snapshot }
  if ($parsed.rows) {
    $rows = @($parsed.rows)
    if ($rows.Count -eq 1 -and $rows[0].snapshot) { return $rows[0].snapshot }
  }
  if ($parsed.result) {
    $result = $parsed.result
    if ($result -is [string]) {
      try { $result = $result | ConvertFrom-Json } catch { throw 'Snapshot remoto no verificable.' }
    }
    if ($result -is [array]) { $result = $result[0] }
    if ($result.snapshot) { return $result.snapshot }
  }
  throw 'Snapshot remoto no verificable.'
}

function Assert-Snapshot {
  param([Parameter(Mandatory = $true)]$Snapshot)
  if (
    $Snapshot.schema_version -ne 1 -or
    $null -eq $Snapshot.relation_signatures -or
    $null -eq $Snapshot.function_signatures -or
    $null -eq $Snapshot.grants -or
    $null -eq $Snapshot.policies -or
    $null -eq $Snapshot.buckets -or
    $null -eq $Snapshot.counts
  ) {
    throw 'Snapshot remoto incompleto.'
  }
  $actual = @($Snapshot.migrations)
  if ($actual.Count -ne $RemoteLedger.Count) { throw 'El inventario remoto no coincide.' }
  for ($index = 0; $index -lt $RemoteLedger.Count; $index += 1) {
    if (
      [string]$actual[$index].version -ne $RemoteLedger[$index].Version -or
      [string]$actual[$index].name -ne $RemoteLedger[$index].Name -or
      ([string]$actual[$index].statements_sha256).ToLowerInvariant() -ne $RemoteLedger[$index].Sha256
    ) {
      throw 'El inventario remoto no coincide.'
    }
  }
}

function Get-CanonicalSnapshot {
  param([Parameter(Mandatory = $true)]$Snapshot)
  return ($Snapshot | ConvertTo-Json -Depth 100 -Compress)
}

function Save-Snapshot {
  param(
    [Parameter(Mandatory = $true)]$Snapshot,
    [Parameter(Mandatory = $true)][string]$Filename
  )
  $target = Join-Path $EvidenceDirectory $Filename
  $json = $Snapshot | ConvertTo-Json -Depth 100
  [System.IO.File]::WriteAllText(
    $target,
    $json,
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Remove-ExactTempRoot {
  param([Parameter(Mandatory = $true)][string]$Path)
  $resolved = [IO.Path]::GetFullPath($Path)
  $tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
  if (
    [IO.Path]::GetDirectoryName($resolved).TrimEnd('\') -ne $tempParent -or
    [IO.Path]::GetFileName($resolved) -notmatch '^crimson-p0-rehearsal-[0-9a-f-]+$'
  ) {
    throw 'Directorio temporal no verificable.'
  }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}

Assert-ExactEnvironment
Assert-SourceLedger

if (-not $SupabaseCli) {
  $SupabaseCli = Join-Path $AppRoot 'node_modules\.bin\supabase.cmd'
}
if (-not (Test-Path -LiteralPath $SupabaseCli -PathType Leaf)) { throw 'CLI Supabase exacto ausente.' }
if (-not (Test-Path -LiteralPath $SnapshotSql -PathType Leaf)) { throw 'SQL de snapshot ausente.' }

$null = Invoke-Checked -Executable $NodeExecutable -Arguments @(
  (Join-Path $ScriptDirectory 'assert-crimson-staging.mjs')
) -FailureMessage 'Guard staging falló.'

$cliVersion = Invoke-Checked -Executable $SupabaseCli -Arguments @('--version') -FailureMessage 'CLI Supabase no verificable.'
if ($cliVersion -ne $ExpectedCliVersion) { throw 'Versión CLI Supabase no autorizada.' }

New-Item -ItemType Directory -Path $EvidenceDirectory -Force | Out-Null
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) "crimson-p0-rehearsal-$([guid]::NewGuid().ToString())"
$tempSupabase = Join-Path $tempRoot 'supabase'

try {
  New-Item -ItemType Directory -Path $tempSupabase -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $AppRoot 'supabase\config.toml') -Destination (Join-Path $tempSupabase 'config.toml')
  $null = Invoke-Checked -Executable $SupabaseCli -Arguments @(
    '--workdir', $tempRoot, '--output-format', 'json', 'link', '--project-ref', $ExpectedStagingRef
  ) -FailureMessage 'No se pudo vincular la proyección temporal exacta.'
  $linkedRefPath = Join-Path $tempSupabase '.temp\project-ref'
  if (-not (Test-Path -LiteralPath $linkedRefPath -PathType Leaf)) {
    throw 'La proyeccion temporal no coincide.'
  }
  $linkedRef = [System.IO.File]::ReadAllText($linkedRefPath).Trim()
  if ($linkedRef -ne $ExpectedStagingRef) { throw 'La proyeccion temporal no coincide.' }

  $snapshots = @()
  foreach ($phase in @('before', 'after', 'rollback')) {
    $raw = Invoke-Checked -Executable $SupabaseCli -Arguments @(
      '--workdir', $tempRoot, '--output-format', 'json', '--log-level', 'error',
      'db', 'query', '--linked', '--file', $SnapshotSql
    ) -FailureMessage 'No se pudo capturar el snapshot remoto.'
    $snapshot = ConvertTo-Snapshot -RawOutput $raw
    Assert-Snapshot -Snapshot $snapshot
    Save-Snapshot -Snapshot $snapshot -Filename "snapshot-$phase.json"
    $snapshots += $snapshot

    if ($phase -eq 'before') {
      $null = Invoke-Checked -Executable $NodeExecutable -Arguments @(
        '--test',
        (Join-Path $AppRoot 'scripts\local-db\privileged-surface-contract.test.mjs'),
        (Join-Path $AppRoot 'scripts\local-db\privileged-surface-verifier-contract.test.mjs'),
        (Join-Path $AppRoot 'scripts\local-db\authenticated-definer-contract.test.mjs')
      ) -FailureMessage 'Gate local de superficies privilegiadas falló.'
      $null = Invoke-Checked -Executable $NodeExecutable -Arguments @(
        '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--experimental-strip-types',
        (Join-Path $AppRoot 'scripts\local-db\storage-matrix.mjs')
      ) -FailureMessage 'Gate local de Storage falló.'
    }
  }

  $canonical = @($snapshots | ForEach-Object { Get-CanonicalSnapshot -Snapshot $_ })
  if ($canonical[0] -ne $canonical[1] -or $canonical[0] -ne $canonical[2]) {
    throw 'Los snapshots count-only cambiaron durante verify-only.'
  }

  $resultMode = if ($Mode -eq 'Apply') { 'apply-authorized-noop' } else { 'verify-only' }
  [ordered]@{
    mode = $resultMode
    projectRef = $ExpectedStagingRef
    migrations = [ordered]@{ baseline = 1; production = 5; forward = 10; storage = 1; stagingOnly = 1; transactionalRehearsal = 1; total = 19 }
    snapshots = @('snapshot-before.json', 'snapshot-after.json', 'snapshot-rollback.json')
    remoteMutations = 0
  } | ConvertTo-Json -Depth 5 -Compress
} finally {
  Remove-ExactTempRoot -Path $tempRoot
}
