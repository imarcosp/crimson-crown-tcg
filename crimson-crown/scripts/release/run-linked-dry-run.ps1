[CmdletBinding()]
param(
  [Parameter()]
  [string]$SupabaseCli
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom

$ProductionProjectRef = 'djfqozfaqkqdoqeoqbzt'
$RequiredSupabaseCliVersion = '2.113.0'
$RepositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$TempRoot = $null
$TempRootUseLock = $null
$DirectorySeparators = [char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
$TempBaseFull = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$TempBase = $TempBaseFull.TrimEnd($DirectorySeparators)
$TempDriveRoot = ([IO.Path]::GetPathRoot($TempBaseFull)).TrimEnd($DirectorySeparators)

$DirectoryLockSource = @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public sealed class CrimsonDirectoryIdentityLock : IDisposable
{
    private const uint DeleteAccess = 0x00010000;
    private const uint FileListDirectory = 0x00000001;
    private const uint FileReadAttributes = 0x00000080;
    private const uint FileShareRead = 0x00000001;
    private const uint FileShareWrite = 0x00000002;
    private const uint OpenExisting = 3;
    private const uint FileFlagBackupSemantics = 0x02000000;
    private const uint FileFlagOpenReparsePoint = 0x00200000;
    private const uint FileAttributeDirectory = 0x00000010;
    private const uint FileAttributeReparsePoint = 0x00000400;

    [StructLayout(LayoutKind.Sequential)]
    private struct ByHandleFileInformation
    {
        public uint FileAttributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
        public uint VolumeSerialNumber;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(
        string fileName,
        uint desiredAccess,
        uint shareMode,
        IntPtr securityAttributes,
        uint creationDisposition,
        uint flagsAndAttributes,
        IntPtr templateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(
        SafeFileHandle file,
        out ByHandleFileInformation information);

    private SafeFileHandle handle;

    private CrimsonDirectoryIdentityLock(SafeFileHandle handle, ByHandleFileInformation information)
    {
        this.handle = handle;
        Attributes = information.FileAttributes;
        VolumeSerialNumber = information.VolumeSerialNumber;
        FileIndex = ((ulong)information.FileIndexHigh << 32) | information.FileIndexLow;
    }

    public uint Attributes { get; private set; }
    public uint VolumeSerialNumber { get; private set; }
    public ulong FileIndex { get; private set; }
    public bool IsReparsePoint { get { return (Attributes & FileAttributeReparsePoint) != 0; } }

    public static CrimsonDirectoryIdentityLock Open(string path)
    {
        SafeFileHandle handle = CreateFileW(
            path,
            DeleteAccess | FileListDirectory | FileReadAttributes,
            FileShareRead | FileShareWrite,
            IntPtr.Zero,
            OpenExisting,
            FileFlagBackupSemantics | FileFlagOpenReparsePoint,
            IntPtr.Zero);
        if (handle.IsInvalid)
        {
            int error = Marshal.GetLastWin32Error();
            handle.Dispose();
            throw new Win32Exception(error);
        }

        ByHandleFileInformation information;
        if (!GetFileInformationByHandle(handle, out information))
        {
            int error = Marshal.GetLastWin32Error();
            handle.Dispose();
            throw new Win32Exception(error);
        }
        if ((information.FileAttributes & FileAttributeDirectory) == 0)
        {
            handle.Dispose();
            throw new IOException("The locked object is not a directory.");
        }

        return new CrimsonDirectoryIdentityLock(handle, information);
    }

    public bool MatchesPath(string path)
    {
        SafeFileHandle pathHandle = CreateFileW(
            path,
            FileReadAttributes,
            FileShareRead | FileShareWrite | 0x00000004,
            IntPtr.Zero,
            OpenExisting,
            FileFlagBackupSemantics | FileFlagOpenReparsePoint,
            IntPtr.Zero);
        if (pathHandle.IsInvalid)
        {
            pathHandle.Dispose();
            return false;
        }

        try
        {
            ByHandleFileInformation information;
            if (!GetFileInformationByHandle(pathHandle, out information))
            {
                return false;
            }
            if (
                (information.FileAttributes & FileAttributeDirectory) == 0 ||
                (information.FileAttributes & FileAttributeReparsePoint) != 0)
            {
                return false;
            }
            ulong fileIndex = ((ulong)information.FileIndexHigh << 32) | information.FileIndexLow;
            return information.VolumeSerialNumber == VolumeSerialNumber && fileIndex == FileIndex;
        }
        finally
        {
            pathHandle.Dispose();
        }
    }

    public void Dispose()
    {
        if (handle != null)
        {
            handle.Dispose();
            handle = null;
        }
    }
}
'@

try {
  Add-Type -TypeDefinition $DirectoryLockSource -Language CSharp -ErrorAction Stop
} catch {
  throw 'No se pudo cargar el helper Win32 de cleanup.'
}

function Open-DirectoryIdentityLock {
  param(
    [Parameter(Mandatory = $true)]
    [string]$LiteralPath
  )

  try {
    return [CrimsonDirectoryIdentityLock]::Open($LiteralPath)
  } catch {
    throw 'No se pudo bloquear la identidad del directorio temporal.'
  }
}

function Open-SafeTempBaseLock {
  if ($TempBase.Equals($TempDriveRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'La base temporal no puede ser la raíz de una unidad.'
  }

  $TempBaseLock = Open-DirectoryIdentityLock -LiteralPath $TempBase
  if ($TempBaseLock.IsReparsePoint) {
    $TempBaseLock.Dispose()
    throw 'La base temporal no es un directorio físico seguro.'
  }
  return $TempBaseLock
}

function Assert-TempRootUseIdentity {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('projection-build', 'link', 'linked-ref-read', 'migration-list', 'dry-run', 'cleanup')]
    [string]$Phase
  )

  if ($null -eq $TempRootUseLock -or $null -eq $TempRoot) {
    throw 'La identidad del directorio temporal no está disponible.'
  }
  try {
    $Matches = $TempRootUseLock.MatchesPath($TempRoot)
  } catch {
    throw 'No se pudo revalidar la identidad del directorio temporal.'
  }
  if (-not $Matches) {
    throw 'La identidad del directorio temporal cambió.'
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

  if (-not $Entry.PSIsContainer) {
    $Entry.Delete()
    return
  }

  $DirectoryLock = Open-DirectoryIdentityLock -LiteralPath $LiteralPath
  try {
    if (-not $DirectoryLock.IsReparsePoint) {
      $Children = @(Get-ChildItem -LiteralPath $LiteralPath -Force -ErrorAction Stop)
      foreach ($Child in $Children) {
        Remove-ExactTree -LiteralPath $Child.FullName
      }
      if (@(Get-ChildItem -LiteralPath $LiteralPath -Force -ErrorAction Stop).Count -ne 0) {
        throw 'El árbol temporal cambió durante el cleanup.'
      }
    }
  } finally {
    $DirectoryLock.Dispose()
  }

  try {
    $DeletionEntry = Get-Item -LiteralPath $LiteralPath -Force -ErrorAction Stop
  } catch [System.Management.Automation.ItemNotFoundException] {
    return
  }
  $DeletionEntry.Delete()
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

function Assert-ExactPropertyNames {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Value,
    [Parameter(Mandatory = $true)]
    [string[]]$ExpectedNames
  )

  $ActualNames = @($Value.PSObject.Properties.Name)
  if ($ActualNames.Count -ne $ExpectedNames.Count) { throw 'summary inválido' }
  for ($Index = 0; $Index -lt $ExpectedNames.Count; $Index += 1) {
    if ($ActualNames[$Index] -cne $ExpectedNames[$Index]) { throw 'summary inválido' }
  }
}

function ConvertTo-StrictStringArray {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [object]$Value,
    [Parameter(Mandatory = $true)]
    [string]$Pattern
  )

  if ($null -eq $Value -or $Value -isnot [System.Array]) { throw 'summary inválido' }
  $Result = [Collections.Generic.List[string]]::new()
  foreach ($Item in $Value) {
    if ($null -eq $Item -or $Item.GetType() -ne [string] -or $Item -cnotmatch $Pattern) {
      throw 'summary inválido'
    }
    $Result.Add([string]$Item)
  }
  return $Result.ToArray()
}

function Assert-StrictlyIncreasing {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [string[]]$Values
  )

  for ($Index = 1; $Index -lt $Values.Count; $Index += 1) {
    if ([StringComparer]::Ordinal.Compare($Values[$Index - 1], $Values[$Index]) -ge 0) {
      throw 'summary inválido'
    }
  }
}

function Assert-VersionedFilenames {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [string[]]$Versions,
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [string[]]$Filenames
  )

  if ($Versions.Count -ne $Filenames.Count) { throw 'summary inválido' }
  for ($Index = 0; $Index -lt $Versions.Count; $Index += 1) {
    if (-not $Filenames[$Index].StartsWith("$($Versions[$Index])_", [StringComparison]::Ordinal)) {
      throw 'summary inválido'
    }
  }
}

function Remove-OuterBlankLines {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [AllowEmptyString()]
    [string[]]$Lines
  )

  $First = 0
  while ($First -lt $Lines.Count -and [string]::IsNullOrWhiteSpace($Lines[$First])) { $First += 1 }
  if ($First -eq $Lines.Count) { return @() }
  $Last = $Lines.Count - 1
  while ($Last -ge $First -and [string]::IsNullOrWhiteSpace($Lines[$Last])) { $Last -= 1 }
  return @($Lines[$First..$Last])
}

function Assert-ExactMigrationList {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [AllowEmptyString()]
    [string[]]$OutputLines,
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [string[]]$RemoteVersions,
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [string[]]$ForwardVersions
  )

  $Lines = @(Remove-OuterBlankLines -Lines $OutputLines)
  if (
    $Lines.Count -lt 4 -or
    $Lines[0] -cne 'Connecting to remote database...' -or
    $Lines[1] -cne '' -or
    $Lines[2] -cne '   Local          | Remote         | Time (UTC)' -or
    $Lines[3] -cne '  ----------------|----------------|---------------------'
  ) {
    throw 'Salida de migration list inválida.'
  }

  $ExpectedRows = [Collections.Generic.List[object]]::new()
  foreach ($Version in $RemoteVersions) {
    $ExpectedRows.Add(@($Version, $Version))
  }
  foreach ($Version in $ForwardVersions) {
    $ExpectedRows.Add(@($Version, ''))
  }
  $Rows = @($Lines | Select-Object -Skip 4)
  if ($Rows.Count -ne $ExpectedRows.Count) { throw 'Salida de migration list inválida.' }

  for ($Index = 0; $Index -lt $Rows.Count; $Index += 1) {
    $Match = [regex]::Match(
      $Rows[$Index],
      '^ {3}(?<local>\d{8,})? *\| *(?<remote>\d{8,})? *\| *(?<time>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) *$'
    )
    if (-not $Match.Success) { throw 'Salida de migration list inválida.' }
    if (
      $Match.Groups['local'].Value -cne $ExpectedRows[$Index][0] -or
      $Match.Groups['remote'].Value -cne $ExpectedRows[$Index][1]
    ) {
      throw 'Salida de migration list inválida.'
    }
  }
}

function Assert-ExactDryRun {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [AllowEmptyString()]
    [string[]]$OutputLines,
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [string[]]$ForwardFilenames
  )

  $Lines = @(Remove-OuterBlankLines -Lines $OutputLines)
  if (
    $Lines.Count -lt 3 -or
    $Lines[0] -cne 'DRY RUN: migrations will *not* be pushed to the database.' -or
    $Lines[1] -cne 'Connecting to remote database...'
  ) {
    throw 'Salida de db push dry-run inválida.'
  }

  if ($ForwardFilenames.Count -eq 0) {
    if ($Lines.Count -ne 3 -or $Lines[2] -cne 'Remote database is up to date.') {
      throw 'Salida de db push dry-run inválida.'
    }
    return
  }

  if (
    $Lines.Count -ne ($ForwardFilenames.Count + 4) -or
    $Lines[2] -cne 'Would push these migrations:' -or
    $Lines[$Lines.Count - 1] -cne 'Finished supabase db push.'
  ) {
    throw 'Salida de db push dry-run inválida.'
  }
  for ($Index = 0; $Index -lt $ForwardFilenames.Count; $Index += 1) {
    $ExpectedLine = " $([char]0x2022) $($ForwardFilenames[$Index])"
    if ($Lines[$Index + 3] -cne $ExpectedLine) { throw 'Salida de db push dry-run inválida.' }
  }
}

function Format-EvidenceArray {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [string[]]$Values
  )

  if ($Values.Count -eq 0) { return '<none>' }
  return ($Values -join ', ')
}

$InitialTempBaseLock = Open-SafeTempBaseLock
$InitialTempBaseLock.Dispose()

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
  $GitShaOutput = @(& $GitExecutable -C $RepositoryRoot rev-parse --verify HEAD 2>&1)
  if ($LASTEXITCODE -ne 0 -or $GitShaOutput.Count -ne 1) {
    throw 'No se pudo verificar el commit Git.'
  }
  $GitSha = $GitShaOutput[0].ToString().Trim()
  if ($GitSha -cnotmatch '^[a-f0-9]{40}$') {
    throw 'No se pudo verificar el commit Git.'
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

  $CliVersionOutput = @(Invoke-Supabase -Executable $ResolvedSupabaseCli -Arguments @(
    '--version'
  ) -FailureMessage 'No se pudo verificar la versión de Supabase CLI.')
  if (
    $CliVersionOutput.Count -ne 1 -or
    $CliVersionOutput[0].Trim() -cne $RequiredSupabaseCliVersion
  ) {
    throw 'Versión de Supabase CLI no permitida.'
  }
  $CliVersion = $RequiredSupabaseCliVersion

  $TempRoot = Join-Path $TempBase ("crimson-release-{0}" -f [Guid]::NewGuid().ToString('N'))
  $CreationBaseLock = Open-SafeTempBaseLock
  try {
    New-Item -ItemType Directory -Path $TempRoot -ErrorAction Stop | Out-Null
    $TempRootUseLock = Open-DirectoryIdentityLock -LiteralPath $TempRoot
    if ($TempRootUseLock.IsReparsePoint) {
      $TempRootUseLock.Dispose()
      $TempRootUseLock = $null
      throw 'El directorio temporal no es un directorio físico seguro.'
    }
  } finally {
    $CreationBaseLock.Dispose()
  }
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
  Assert-TempRootUseIdentity -Phase 'projection-build'
  $ProjectionOutput = @(& $NodeExecutable --input-type=module -e $ProjectionBuilder $RepositoryRoot $Projection 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw 'La proyección de release fue rechazada.'
  }

  try {
    $ProjectionSummary = ($ProjectionOutput -join '') | ConvertFrom-Json
    Assert-ExactPropertyNames -Value $ProjectionSummary -ExpectedNames @(
      'forwardPendingCount',
      'forwardPendingVersions',
      'forwardPendingFilenames',
      'projectedRemoteVersions',
      'projectedRemoteFilenames'
    )
    $IntegerTypes = @(
      [System.Byte],
      [System.SByte],
      [System.Int16],
      [System.UInt16],
      [System.Int32],
      [System.UInt32],
      [System.Int64],
      [System.UInt64]
    )
    if (
      $null -eq $ProjectionSummary.forwardPendingCount -or
      $IntegerTypes -notcontains $ProjectionSummary.forwardPendingCount.GetType()
    ) {
      throw 'summary inválido'
    }
    $ForwardPendingCount = [long]$ProjectionSummary.forwardPendingCount
    if ($ForwardPendingCount -lt 0) { throw 'summary inválido' }
    $ForwardPendingVersions = @(ConvertTo-StrictStringArray `
      -Value $ProjectionSummary.forwardPendingVersions `
      -Pattern '^\d{8,}$')
    $ForwardPendingFilenames = @(ConvertTo-StrictStringArray `
      -Value $ProjectionSummary.forwardPendingFilenames `
      -Pattern '^\d{8,}_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$')
    $ProjectedRemoteVersions = @(ConvertTo-StrictStringArray `
      -Value $ProjectionSummary.projectedRemoteVersions `
      -Pattern '^\d{8,}$')
    $ProjectedRemoteFilenames = @(ConvertTo-StrictStringArray `
      -Value $ProjectionSummary.projectedRemoteFilenames `
      -Pattern '^\d{8,}_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$')
    if (
      $ForwardPendingCount -ne $ForwardPendingVersions.Count -or
      $ForwardPendingCount -ne $ForwardPendingFilenames.Count -or
      $ProjectedRemoteVersions.Count -ne $ProjectedRemoteFilenames.Count
    ) {
      throw 'summary inválido'
    }
    Assert-StrictlyIncreasing -Values $ForwardPendingVersions
    Assert-StrictlyIncreasing -Values $ForwardPendingFilenames
    Assert-StrictlyIncreasing -Values $ProjectedRemoteVersions
    Assert-StrictlyIncreasing -Values $ProjectedRemoteFilenames
    Assert-StrictlyIncreasing -Values @($ProjectedRemoteVersions + $ForwardPendingVersions)
    Assert-VersionedFilenames -Versions $ForwardPendingVersions -Filenames $ForwardPendingFilenames
    Assert-VersionedFilenames -Versions $ProjectedRemoteVersions -Filenames $ProjectedRemoteFilenames
  } catch {
    throw 'Summary de proyección inválido.'
  }

  Assert-TempRootUseIdentity -Phase 'link'
  $LinkOutput = Invoke-Supabase -Executable $ResolvedSupabaseCli -Arguments @(
    '--workdir', $Projection, 'link', '--project-ref', $ProductionProjectRef
  ) -FailureMessage 'Supabase link falló.'

  $LinkedRefPath = Join-Path $Projection 'supabase\.temp\project-ref'
  Assert-TempRootUseIdentity -Phase 'linked-ref-read'
  try {
    $LinkedRef = (Get-Content -Raw -LiteralPath $LinkedRefPath).Trim()
  } catch {
    throw 'Falta la referencia enlazada aislada.'
  }
  if ($LinkedRef -cne $ProductionProjectRef) {
    throw 'La referencia enlazada no pertenece a Crimson producción.'
  }

  Assert-TempRootUseIdentity -Phase 'migration-list'
  $MigrationOutput = Invoke-Supabase -Executable $ResolvedSupabaseCli -Arguments @(
    '--workdir', $Projection, 'migration', 'list', '--linked'
  ) -FailureMessage 'Supabase migration list falló.'

  Assert-ExactMigrationList `
    -OutputLines @($MigrationOutput) `
    -RemoteVersions $ProjectedRemoteVersions `
    -ForwardVersions $ForwardPendingVersions

  Assert-TempRootUseIdentity -Phase 'dry-run'
  $PushOutput = Invoke-Supabase -Executable $ResolvedSupabaseCli -Arguments @(
    '--workdir', $Projection, 'db', 'push', '--linked', '--dry-run'
  ) -FailureMessage 'Supabase db push dry-run falló.'

  Assert-ExactDryRun -OutputLines @($PushOutput) -ForwardFilenames $ForwardPendingFilenames

  Write-Output "Supabase CLI version: $CliVersion"
  Write-Output "Git SHA: $GitSha"
  Write-Output "Projected remote versions: $(Format-EvidenceArray -Values $ProjectedRemoteVersions)"
  Write-Output "Projected remote filenames: $(Format-EvidenceArray -Values $ProjectedRemoteFilenames)"
  Write-Output "Approved forward count: $ForwardPendingCount"
  Write-Output "Approved forward versions: $(Format-EvidenceArray -Values $ForwardPendingVersions)"
  Write-Output "Approved forward filenames: $(Format-EvidenceArray -Values $ForwardPendingFilenames)"
  Write-Output 'Migration list outcome: exact'
  Write-Output "Dry-run outcome: $(if ($ForwardPendingCount -eq 0) { 'up to date' } else { 'exact batch' })"
} finally {
  if ($null -ne $TempRoot) {
    $CleanupBaseLock = Open-SafeTempBaseLock
    try {
      $CleanupTarget = [IO.Path]::GetFullPath($TempRoot)
      $CleanupParent = ([IO.Path]::GetDirectoryName($CleanupTarget)).TrimEnd($DirectorySeparators)
      $CleanupLeaf = [IO.Path]::GetFileName($CleanupTarget)
      if (
        -not $CleanupParent.Equals($TempBase, [StringComparison]::OrdinalIgnoreCase) -or
        $CleanupLeaf -cnotmatch '^crimson-release-[0-9a-f]{32}$'
      ) {
        throw 'Destino temporal de cleanup rechazado.'
      }
      if ($null -ne $TempRootUseLock) {
        try {
          Assert-TempRootUseIdentity -Phase 'cleanup'
        } finally {
          $TempRootUseLock.Dispose()
          $TempRootUseLock = $null
        }
      }
      Remove-ExactTree -LiteralPath $CleanupTarget
    } finally {
      if ($null -ne $TempRootUseLock) {
        $TempRootUseLock.Dispose()
        $TempRootUseLock = $null
      }
      $CleanupBaseLock.Dispose()
    }
  }
}
