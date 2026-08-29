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
$TempBase = ([IO.Path]::GetFullPath([IO.Path]::GetTempPath())).TrimEnd($DirectorySeparators)

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
await buildProjection({ rootDir, outputDir });
'@
  $ProjectionOutput = @(& $NodeExecutable --input-type=module -e $ProjectionBuilder $RepositoryRoot $Projection 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw 'La proyección de release fue rechazada.'
  }

  $ManifestPath = Join-Path $RepositoryRoot 'scripts\release\migration-manifest.json'
  try {
    $Manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
    $ForwardPending = @($Manifest.entries | Where-Object { $_.class -eq 'forward_pending' })
  } catch {
    throw 'No se pudo leer el manifiesto verificado.'
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

  if ($ForwardPending.Count -gt 0 -and (($PushOutput -join "`n") -match '(?i)up[ -]?to[ -]?date')) {
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
    if (Test-Path -LiteralPath $CleanupTarget) {
      Remove-Item -LiteralPath $CleanupTarget -Recurse -Force -ErrorAction Stop
    }
  }
}
