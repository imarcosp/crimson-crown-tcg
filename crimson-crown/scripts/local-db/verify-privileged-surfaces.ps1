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

$expectedAuthenticatedDefiners = @(
    'admin_create_or_restock_product(uuid,jsonb,text)',
    'admin_delete_products(uuid,uuid[],text)',
    'admin_update_product(uuid,uuid,jsonb,text)',
    'append_import_order_user_note(bigint,text)',
    'approve_buylist_transaction(uuid,numeric)',
    'archive_inventory(uuid)',
    'cancel_order_atomic(uuid,boolean,boolean)',
    'create_inventory(text,text,text)',
    'decrement_stock(integer,uuid)',
    'delete_inventory_safely(uuid)',
    'get_inventory_metrics(uuid)',
    'is_admin()',
    'is_commission_admin()',
    'manage_credits(uuid,numeric,text,text,uuid)',
    'place_order_atomic(jsonb,text,text,jsonb,boolean,text,text,text)',
    'refund_order_atomic(uuid,boolean,numeric)',
    'release_expired_orders_atomic(integer,text)',
    'remove_order_item_atomic(uuid,integer,boolean)',
    'restore_order_inventory_atomic(uuid,text)',
    'restore_stock(uuid)',
    'set_inventory_active(uuid,boolean)',
    'submit_order_payment_proof(uuid,text)',
    'transfer_credits(text,numeric,text)',
    'update_profile_details(text,text,text)',
    'user_accept_buylist_offer(uuid)'
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
$authenticatedValuesSql = ($expectedAuthenticatedDefiners | ForEach-Object {
    if ($_ -notmatch '^[a-z_][a-z0-9_]*\((?:(?:bigint|integer|text|uuid(?:\[\])?|jsonb|numeric|boolean)(?:,)?)*\)$') {
        throw 'El contrato de definers autenticadas contiene una firma SQL no permitida.'
    }
    "('$_')"
}) -join ",`n  "
$payload = @"
begin;
create temp table expected_privileged_surfaces (
  signature text primary key,
  allowed_roles text[] not null
) on commit drop;
insert into expected_privileged_surfaces (signature, allowed_roles) values
  $valuesSql;
create temp table expected_authenticated_definers (
  signature text primary key
) on commit drop;
insert into expected_authenticated_definers (signature) values
  $authenticatedValuesSql;
$verificationSql
rollback;
"@

$payload | & docker exec -i -e PGPASSWORD=postgres $expectedContainer psql -U supabase_admin -d postgres -X -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) {
    throw 'Fallo la verificacion del catalogo PostgreSQL local.'
}

Write-Output 'PRIVILEGED_SURFACES_OK'
