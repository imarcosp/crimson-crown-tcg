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
  $CreationBaseLock = Open-SafeTempBaseLock
  try {
    New-Item -ItemType Directory -Path $TempRoot -ErrorAction Stop | Out-Null
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
  $ProjectionOutput = @(& $NodeExecutable --input-type=module -e $ProjectionBuilder $RepositoryRoot $Projection 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw 'La proyección de release fue rechazada.'
  }

  try {
    $ProjectionSummary = ($ProjectionOutput -join '') | ConvertFrom-Json
    $SummaryProperties = @($ProjectionSummary.PSObject.Properties.Name)
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
      $SummaryProperties.Count -ne 1 -or
      $SummaryProperties[0] -cne 'forwardPendingCount' -or
      $null -eq $ProjectionSummary.forwardPendingCount -or
      $IntegerTypes -notcontains $ProjectionSummary.forwardPendingCount.GetType()
    ) {
      throw 'summary inválido'
    }
    $ForwardPendingCount = [long]$ProjectionSummary.forwardPendingCount
    if ($ForwardPendingCount -lt 0) { throw 'summary inválido' }
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
      Remove-ExactTree -LiteralPath $CleanupTarget
    } finally {
      $CleanupBaseLock.Dispose()
    }
  }
}
