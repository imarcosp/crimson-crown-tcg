[CmdletBinding()]
param(
  [Parameter()]
  [string]$SupabaseCli
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProductionProjectRef = 'djfqozfaqkqdoqeoqbzt'
$RepositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$TempRoot = $null
$DirectorySeparators = [char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
$TempBaseFull = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$TempBase = $TempBaseFull.TrimEnd($DirectorySeparators)
$TempDriveRoot = ([IO.Path]::GetPathRoot($TempBaseFull)).TrimEnd($DirectorySeparators)

function Test-ReparsePoint {
  param(
    [Parameter(Mandatory = $true)]
    [IO.FileSystemInfo]$Item
  )

  return (($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)
}

function Assert-SafeTempBase {
  if ($TempBase.Equals($TempDriveRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'La base temporal no puede ser la raíz de una unidad.'
  }

  try {
    $TempBaseItem = Get-Item -LiteralPath $TempBase -Force -ErrorAction Stop
  } catch {
    throw 'La base temporal no está disponible.'
  }
  if (-not $TempBaseItem.PSIsContainer -or (Test-ReparsePoint -Item $TempBaseItem)) {
    throw 'La base temporal no es un directorio físico seguro.'
  }
}

function Remove-ExactTree {
  param(
    [Parameter(Mandatory = $true)]
    [string]$LiteralPath
  )

  try {
    $Entry = Get-Item -LiteralPath $LiteralPath -Force -ErrorAction Stop
  } catch [System.Management.Automation.ItemNotFoundException] {
    return
  }

  if (Test-ReparsePoint -Item $Entry) {
    $Entry.Delete()
    return
  }
  if (-not $Entry.PSIsContainer) {
    Remove-Item -LiteralPath $Entry.FullName -Force -ErrorAction Stop
    return
  }

  $Children = @(Get-ChildItem -LiteralPath $Entry.FullName -Force -ErrorAction Stop)
  foreach ($Child in $Children) {
    Remove-ExactTree -LiteralPath $Child.FullName
  }

  try {
    $RevalidatedEntry = Get-Item -LiteralPath $LiteralPath -Force -ErrorAction Stop
  } catch [System.Management.Automation.ItemNotFoundException] {
    return
  }
  if (Test-ReparsePoint -Item $RevalidatedEntry) {
    $RevalidatedEntry.Delete()
    return
  }
  if (-not $RevalidatedEntry.PSIsContainer) {
    Remove-Item -LiteralPath $RevalidatedEntry.FullName -Force -ErrorAction Stop
    return
  }

  if (@(Get-ChildItem -LiteralPath $RevalidatedEntry.FullName -Force -ErrorAction Stop).Count -ne 0) {
    throw 'El árbol temporal cambió durante el cleanup.'
  }
  Remove-Item -LiteralPath $RevalidatedEntry.FullName -Force -ErrorAction Stop
}

function Resolve-ExecutableFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$ErrorMessage
  )

  try {
    $Item = Get-Item -LiteralPath $Path -ErrorAction Stop
  } catch {
    throw $ErrorMessage
  }
  if ($Item.PSIsContainer) {
    throw $ErrorMessage
  }
  return $Item.FullName
}

function Invoke-Supabase {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Executable,
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,
    [Parameter(Mandatory = $true)]
    [string]$FailureMessage
  )

  $Output = @(& $Executable @Arguments 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw $FailureMessage
  }
  return @($Output | ForEach-Object { $_.ToString() })
}

Assert-SafeTempBase

try {
  try {
    $GitExecutable = (Get-Command git.exe -ErrorAction Stop).Source
    $GitStatus = @(& $GitExecutable -C $RepositoryRoot status --porcelain=v1 --untracked-files=all 2>&1)
  } catch {
    throw 'No se pudo verificar el worktree Git.'
  }
  if ($LASTEXITCODE -ne 0) {
    throw 'No se pudo verificar el worktree Git.'
  }
  if ($GitStatus.Count -ne 0) {
    throw 'El worktree Git debe estar limpio.'
  }

  if ([string]::IsNullOrWhiteSpace($SupabaseCli)) {
    $SupabaseCli = Join-Path $RepositoryRoot 'node_modules\.bin\supabase.cmd'
  }
  $ResolvedSupabaseCli = Resolve-ExecutableFile -Path $SupabaseCli -ErrorMessage 'Supabase CLI no disponible.'

  try {
    $NodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
  } catch {
    throw 'Node.js no disponible.'
  }

  Assert-SafeTempBase
  $TempRoot = Join-Path $TempBase ("crimson-release-{0}" -f [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $TempRoot -ErrorAction Stop | Out-Null
  $Projection = Join-Path $TempRoot 'projection'

  $ProjectionBuilder = @'
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const rootDir = process.argv[1];
const outputDir = process.argv[2];
const modulePath = pathToFileURL(join(rootDir, 'scripts', 'release', 'build-supabase-projection.mjs'));
const { buildProjection } = await import(modulePath.href);
const summary = await buildProjection({ rootDir, outputDir });
process.stdout.write(JSON.stringify(summary));
'@
  $ProjectionOutput = @(& $NodeExecutable --input-type=module -e $ProjectionBuilder $RepositoryRoot $Projection 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw 'La proyección de release fue rechazada.'
  }

  try {
    $ProjectionSummary = ($ProjectionOutput -join '') | ConvertFrom-Json
    $SummaryProperties = @($ProjectionSummary.PSObject.Properties.Name)
    $ForwardPendingCount = 0
    if (
      $SummaryProperties.Count -ne 1 -or
      $SummaryProperties[0] -cne 'forwardPendingCount' -or
      -not [int]::TryParse([string]$ProjectionSummary.forwardPendingCount, [ref]$ForwardPendingCount) -or
      $ForwardPendingCount -lt 0
    ) {
      throw 'summary inválido'
    }
  } catch {
    throw 'Summary de proyección inválido.'
  }

  $LinkOutput = Invoke-Supabase -Executable $ResolvedSupabaseCli -Arguments @(
    '--workdir', $Projection, 'link', '--project-ref', $ProductionProjectRef
  ) -FailureMessage 'Supabase link falló.'

  $LinkedRefPath = Join-Path $Projection 'supabase\.temp\project-ref'
  try {
    $LinkedRef = (Get-Content -Raw -LiteralPath $LinkedRefPath).Trim()
  } catch {
    throw 'Falta la referencia enlazada aislada.'
  }
  if ($LinkedRef -cne $ProductionProjectRef) {
    throw 'La referencia enlazada no pertenece a Crimson producción.'
  }

  $MigrationOutput = Invoke-Supabase -Executable $ResolvedSupabaseCli -Arguments @(
    '--workdir', $Projection, 'migration', 'list', '--linked'
  ) -FailureMessage 'Supabase migration list falló.'

  $PushOutput = Invoke-Supabase -Executable $ResolvedSupabaseCli -Arguments @(
    '--workdir', $Projection, 'db', 'push', '--linked', '--dry-run'
  ) -FailureMessage 'Supabase db push dry-run falló.'

  if ($ForwardPendingCount -gt 0 -and (($PushOutput -join "`n") -match '(?i)up[ -]?to[ -]?date')) {
    throw 'Resultado up to date incompatible con migraciones forward pendientes.'
  }

  Write-Output $MigrationOutput
  Write-Output $PushOutput
} finally {
  if ($null -ne $TempRoot) {
    $CleanupTarget = [IO.Path]::GetFullPath($TempRoot)
    $CleanupParent = ([IO.Path]::GetDirectoryName($CleanupTarget)).TrimEnd($DirectorySeparators)
    $CleanupLeaf = [IO.Path]::GetFileName($CleanupTarget)
    if (
      -not $CleanupParent.Equals($TempBase, [StringComparison]::OrdinalIgnoreCase) -or
      $CleanupLeaf -cnotmatch '^crimson-release-[0-9a-f]{32}$'
    ) {
      throw 'Destino temporal de cleanup rechazado.'
    }
    Remove-ExactTree -LiteralPath $CleanupTarget
  }
}
