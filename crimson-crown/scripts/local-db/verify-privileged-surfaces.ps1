$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($args.Count -ne 0) {
    throw 'El verificador no acepta parametros.'
}

$expectedContainer = 'supabase_db_crimson-crown'
$expectedPort = 54621
$appRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$environmentFile = Join-Path $appRoot '.env.test.local'
$inventoryFile = Join-Path $appRoot 'docs\security\crimson-security-definer-inventory.json'
$verificationFile = Join-Path $PSScriptRoot 'verify-privileged-surfaces.sql'

foreach ($requiredFile in @($environmentFile, $inventoryFile, $verificationFile)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Falta un archivo local requerido: $([System.IO.Path]::GetFileName($requiredFile))"
    }
}

$urlMatches = @(Get-Content -LiteralPath $environmentFile | Where-Object {
    $_ -match '^\s*NEXT_PUBLIC_SUPABASE_URL\s*='
})
if ($urlMatches.Count -ne 1) {
    throw 'El entorno local debe declarar NEXT_PUBLIC_SUPABASE_URL exactamente una vez.'
}

$rawUrl = ($urlMatches[0] -split '=', 2)[1].Trim()
$localUrl = $null
if (-not [System.Uri]::TryCreate($rawUrl, [System.UriKind]::Absolute, [ref]$localUrl)) {
    throw 'NEXT_PUBLIC_SUPABASE_URL no es una URL absoluta valida.'
}

$loopbackHosts = @('127.0.0.1', 'localhost', '::1')
if ($localUrl.Scheme -ne 'http' -or
    $loopbackHosts -notcontains $localUrl.Host -or
    $localUrl.Port -ne $expectedPort -or
    $localUrl.UserInfo -ne '' -or
    $localUrl.Query -ne '' -or
    $localUrl.Fragment -ne '' -or
    $localUrl.AbsolutePath -ne '/') {
    throw 'El verificador exige Supabase local en loopback y puerto 54621.'
}

$expectedSignatures = @(
    'assign_import_order_number()',
    'calculate_import_order_total(bigint)',
    'delete_trash_products(integer)',
    'find_orders_by_id_part(text)',
    'generate_import_order_number()',
    'generate_next_import_order_number()',
    'get_inventory_valuation()',
    'get_trash_products(integer)',
    'handle_new_user()',
    'is_commission_admin()',
    'merge_duplicate_products(integer)',
    'notify_buylist_manager()',
    'notify_credit_change()',
    'notify_import_manager()',
    'notify_order_manager()',
    'notify_stock_alert()',
    'on_commission_adjustments_change()',
    'on_commission_allocations_change()',
    'recalculate_commission_period_status(uuid)',
    'refresh_commission_period(text)',
    'refresh_commission_period(text, numeric, numeric, boolean)',
    'set_import_order_commission_eligible()',
    'set_order_commission_eligible()',
    'sync_product_prices()'
)

$inventory = Get-Content -LiteralPath $inventoryFile -Raw | ConvertFrom-Json
if ($inventory.Count -ne $expectedSignatures.Count) {
    throw 'El inventario privilegiado debe contener exactamente 24 firmas.'
}

$allowedRoleNames = @('authenticated', 'service_role')
$rows = New-Object System.Collections.Generic.List[string]
$actualSignatures = New-Object System.Collections.Generic.List[string]
foreach ($surface in ($inventory | Sort-Object -Property signature)) {
    $signature = [string]$surface.signature
    if ($signature -notmatch '^[a-z_][a-z0-9_]*\((?:(?:bigint|integer|text|uuid|numeric|boolean)(?:, )?)*\)$') {
        throw 'El inventario contiene una firma SQL no permitida.'
    }

    $roles = @($surface.allowedRoles)
    $uniqueRoles = @($roles | Sort-Object -Unique)
    if ($roles.Count -eq 0 -or $roles.Count -ne $uniqueRoles.Count -or
        @($uniqueRoles | Where-Object { $allowedRoleNames -notcontains $_ }).Count -ne 0) {
        throw "Roles no permitidos para $signature."
    }

    $actualSignatures.Add($signature)
    $roleSql = ($roles | Sort-Object | ForEach-Object { "'$_'" }) -join ', '
    $rows.Add("('$signature', array[$roleSql]::text[])")
}

if (@(Compare-Object -ReferenceObject ($expectedSignatures | Sort-Object) -DifferenceObject $actualSignatures).Count -ne 0) {
    throw 'Las firmas del inventario privilegiado no coinciden con el contrato.'
}

$runningContainers = @(& docker ps --filter "name=^$expectedContainer`$" --format '{{.Names}}')
if ($LASTEXITCODE -ne 0 -or $runningContainers.Count -ne 1 -or $runningContainers[0] -ne $expectedContainer) {
    throw "El contenedor local exacto $expectedContainer no esta disponible."
}

$verificationSql = Get-Content -LiteralPath $verificationFile -Raw
$valuesSql = $rows -join ",`n  "
$payload = @"
begin;
create temp table expected_privileged_surfaces (
  signature text primary key,
  allowed_roles text[] not null
) on commit drop;
insert into expected_privileged_surfaces (signature, allowed_roles) values
  $valuesSql;
$verificationSql
rollback;
"@

$payload | & docker exec -i $expectedContainer psql -U supabase_admin -d postgres -X -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) {
    throw 'Fallo la verificacion del catalogo PostgreSQL local.'
}

Write-Output 'PRIVILEGED_SURFACES_OK'
