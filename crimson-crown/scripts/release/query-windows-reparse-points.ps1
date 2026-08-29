[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0, ValueFromRemainingArguments = $true)]
  [string[]]$LiteralPaths
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

try {
  if ($LiteralPaths.Count -eq 0) {
    exit 2
  }

  foreach ($LiteralPath in $LiteralPaths) {
    $Attributes = [IO.File]::GetAttributes($LiteralPath)
    if (($Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      exit 3
    }
  }

  [Console]::Out.Write('SAFE')
} catch {
  exit 2
}
