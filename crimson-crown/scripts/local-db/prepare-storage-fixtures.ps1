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
if ($parsedUrl.Host -notin @('127.0.0.1', 'localhost', '::1')) {
    throw 'Este script sólo permite Supabase en loopback.'
}

$headers = @{
    Authorization = "Bearer $serviceKey"
    apikey = $serviceKey
    'Content-Type' = 'application/json'
}

foreach ($name in @('payment_proofs', 'products', 'banners')) {
    $body = @{
        id = $name
        name = $name
        public = $true
        file_size_limit = 5242880
        allowed_mime_types = @('image/*')
    } | ConvertTo-Json

    try {
        Invoke-RestMethod -Uri "$supabaseUrl/storage/v1/bucket" -Method Post -Headers $headers -Body $body | Out-Null
    } catch {
        $status = 0
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $status = [int]$_.Exception.Response.StatusCode
        }
        $detail = $_.ErrorDetails.Message
        if ($status -ne 409 -and $detail -notmatch 'BucketAlreadyExists|already exists') { throw }
    }
}

$container = 'supabase_db_crimson-crown'
docker inspect $container | Out-Null
$sqlPath = Join-Path $PSScriptRoot 'storage-fixtures.sql'
Get-Content -Raw -LiteralPath $sqlPath | docker exec -i $container psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1
Write-Output 'Fixtures locales de Storage preparados.'
