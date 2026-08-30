$ErrorActionPreference = 'Stop'

$expectedContainer = 'supabase_db_crimson-crown'
$expectedDatabasePort = '54622'
$sqlPath = Join-Path $PSScriptRoot 'auth-trigger-fixture.sql'

if (-not (Test-Path -LiteralPath $sqlPath -PathType Leaf)) {
    throw 'Falta el SQL local del fixture Auth.'
}

$containerJson = & docker inspect $expectedContainer 2>$null
if ($LASTEXITCODE -ne 0) {
    throw 'El contenedor local esperado de Crimson no está disponible.'
}

$container = @($containerJson | ConvertFrom-Json)[0]
if ($container.Name -ne "/$expectedContainer" -or $container.State.Status -ne 'running') {
    throw 'La identidad del contenedor local de Crimson no coincide.'
}

$dbBindings = @($container.HostConfig.PortBindings.'5432/tcp')
if ($dbBindings.Count -ne 1 -or $dbBindings[0].HostPort -ne '54622') {
    throw "El Postgres local de Crimson debe publicar únicamente el puerto $expectedDatabasePort."
}

Get-Content -Raw -LiteralPath $sqlPath | & docker exec -e PGPASSWORD=postgres -i $expectedContainer psql -U postgres -d postgres -X -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) {
    throw 'No se pudo preparar el trigger Auth en la réplica local.'
}

Write-Output 'Fixture Auth local de Crimson instalado y verificado.'
