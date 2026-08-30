$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$envPath = Join-Path $repoRoot '.env.test.local'
if (-not (Test-Path -LiteralPath $envPath)) {
    throw 'Falta .env.test.local; no se preparan fixtures de Storage.'
}

function Get-EnvValue([string]$name) {
    $line = Get-Content -LiteralPath $envPath | Where-Object { $_ -match "^$name=" } | Select-Object -First 1
    if (-not $line) { return $null }
    return ($line -replace "^$name=", '').Trim()
}

$supabaseUrl = Get-EnvValue 'NEXT_PUBLIC_SUPABASE_URL'
$serviceKey = Get-EnvValue 'SUPABASE_SERVICE_ROLE_KEY'
if (-not $supabaseUrl -or -not $serviceKey) { throw 'Faltan credenciales de Supabase local.' }

$parsedUrl = [Uri]$supabaseUrl
if (
    $parsedUrl.Scheme -ne 'http' -or
    $parsedUrl.Host -notin @('127.0.0.1', 'localhost', '::1') -or
    $parsedUrl.Port -ne 54621 -or
    $parsedUrl.AbsolutePath -ne '/' -or
    $parsedUrl.Query -or
    $parsedUrl.Fragment -or
    $parsedUrl.UserInfo
) {
    throw 'Este script sólo permite el API local exacto de Crimson en loopback:54621.'
}

$headers = @{
    Authorization = "Bearer $serviceKey"
    apikey = $serviceKey
    'Content-Type' = 'application/json'
}

$expectedStackWorkdir = [IO.Path]::GetFullPath('D:\crimson-crown-tcg\crimson-crown')
$containerStateJson = docker inspect supabase_kong_crimson-crown supabase_db_crimson-crown
if ($LASTEXITCODE -ne 0) {
    throw 'No se pudo inspeccionar el stack local exacto de Crimson.'
}
try {
    $containerStateRaw = $containerStateJson -join [Environment]::NewLine
    $containerStates = ConvertFrom-Json -InputObject $containerStateRaw
} catch {
    throw 'Docker no devolvió una identidad local verificable.'
}
if (@($containerStates).Count -ne 2) { throw 'El stack local exacto de Crimson está incompleto.' }

$apiContainer = $containerStates | Where-Object { $_.Name -eq '/supabase_kong_crimson-crown' } | Select-Object -First 1
$dbContainer = $containerStates | Where-Object { $_.Name -eq '/supabase_db_crimson-crown' } | Select-Object -First 1
if (-not $apiContainer -or -not $dbContainer -or -not $apiContainer.State.Running -or -not $dbContainer.State.Running) {
    throw 'Los contenedores locales exactos de Crimson no están activos.'
}

$apiBindings = @($apiContainer.HostConfig.PortBindings.'8000/tcp')
$dbBindings = @($dbContainer.HostConfig.PortBindings.'5432/tcp')
if (
    $apiBindings.Count -ne 1 -or $apiBindings[0].HostPort -ne '54621' -or
    $dbBindings.Count -ne 1 -or $dbBindings[0].HostPort -ne '54622'
) {
    throw 'Los puertos publicados no pertenecen al stack local exacto de Crimson.'
}

$apiLabels = $apiContainer.Config.Labels
$dbLabels = $dbContainer.Config.Labels
$apiWorkdir = [IO.Path]::GetFullPath($apiLabels.'com.supabase.cli.workdir')
$dbWorkdir = [IO.Path]::GetFullPath($dbLabels.'com.supabase.cli.workdir')
if (
    $apiLabels.'com.docker.compose.project' -ne 'crimson-crown' -or
    $dbLabels.'com.docker.compose.project' -ne 'crimson-crown' -or
    $apiLabels.'com.supabase.cli.project' -ne 'crimson-crown' -or
    $dbLabels.'com.supabase.cli.project' -ne 'crimson-crown' -or
    -not $apiWorkdir.Equals($expectedStackWorkdir, [StringComparison]::OrdinalIgnoreCase) -or
    -not $dbWorkdir.Equals($expectedStackWorkdir, [StringComparison]::OrdinalIgnoreCase) -or
    -not $apiWorkdir.Equals($dbWorkdir, [StringComparison]::OrdinalIgnoreCase)
) {
    throw 'El API y la base no pertenecen al mismo stack local exacto de Crimson.'
}

$bucketConfig = [ordered]@{
    products = @{
        public = $true
        allowed = @('image/jpeg', 'image/png', 'image/webp')
    }
    banners = @{
        public = $true
        allowed = @('image/jpeg', 'image/png', 'image/webp')
    }
    payment_proofs = @{
        public = $false
        allowed = @('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
    }
}

foreach ($entry in $bucketConfig.GetEnumerator()) {
    $name = $entry.Key
    $expected = $entry.Value
    $body = @{
        id = $name
        name = $name
        public = $expected.public
        file_size_limit = 5242880
        allowed_mime_types = $expected.allowed
    } | ConvertTo-Json

    try {
        Invoke-RestMethod -Uri "$supabaseUrl/storage/v1/bucket" -Method Post -Headers $headers -Body $body | Out-Null
    } catch {
        $responseStatus = if ($_.Exception.Response) { [string]$_.Exception.Response.StatusCode } else { 'none' }
        $status = 0
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            try { $status = [int]$_.Exception.Response.StatusCode.value__ } catch { $status = 0 }
        }
        $detail = $_.ErrorDetails.Message
        $bodyStatus = 0
        if ($detail) {
            try {
                $errorBody = $detail | ConvertFrom-Json
                $bodyStatus = [int]$errorBody.statusCode
            } catch {
                $bodyStatus = 0
            }
        }
        $isConflict = $status -eq 409 -or $bodyStatus -eq 409
        if (-not $isConflict) {
            throw "Falló la creación del bucket $name (status=$status; bodyStatus=$bodyStatus; response=$responseStatus)."
        }
    }

    Invoke-RestMethod -Uri "$supabaseUrl/storage/v1/bucket/$name" -Method Put -Headers $headers -Body $body | Out-Null

    $actual = Invoke-RestMethod -Uri "$supabaseUrl/storage/v1/bucket/$name" -Method Get -Headers $headers
    $mimeDelta = @(Compare-Object @($expected.allowed | Sort-Object) @($actual.allowed_mime_types | Sort-Object))
    if (
        [bool]$actual.public -ne [bool]$expected.public -or
        [int64]$actual.file_size_limit -ne 5242880 -or
        $mimeDelta.Count -ne 0
    ) {
        throw "La configuración verificada del bucket $name no coincide con el estado requerido."
    }
}

$sqlPath = Join-Path $PSScriptRoot 'storage-fixtures.sql'
Get-Content -Raw -LiteralPath $sqlPath | docker exec -i supabase_db_crimson-crown psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron aplicar las políticas locales de Storage.' }
Write-Output 'Fixtures locales de Storage preparados.'
