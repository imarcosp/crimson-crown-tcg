import { execFile } from "node:child_process";
import net from "node:net";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

export const LOCAL_SERVICE_PORTS = [54621, 54622, 54623, 54624];
export const LOCAL_DOCKER_NETWORK = "crimson-crown-local-loopback";
const execFileAsync = promisify(execFile);

const FIREWALL_RULES = [
  "Crimson Crown Local Supabase - Block IPv4 Non-Loopback",
  "Crimson Crown Local Supabase - Block IPv6",
  "Crimson Crown Local Supabase - Docker Backend Block IPv4 Non-Loopback",
  "Crimson Crown Local Supabase - Docker Backend Block IPv6",
];

export class UnsafeLocalNetworkError extends Error {
  constructor() {
    super(
      "Aislamiento de red local no seguro; no se permite restaurar ni usar datos productivos.",
    );
    this.name = "UnsafeLocalNetworkError";
  }
}

export function assertNetworkIsolation({
  loopbackResults,
  firewallPolicyVerified,
  dockerNetworkVerified,
  nonLoopbackResults,
}) {
  const loopbackReady = LOCAL_SERVICE_PORTS.every((port) =>
    loopbackResults?.some(
      (result) => result.port === port && result.reachable === true,
    ),
  );
  const explicitNetworkProof =
    firewallPolicyVerified === true && dockerNetworkVerified === true;
  const legacyProbeProof =
    Array.isArray(nonLoopbackResults) &&
    nonLoopbackResults.length > 0 &&
    nonLoopbackResults.every((result) => result.reachable === false);

  if (!loopbackReady || (!explicitNetworkProof && !legacyProbeProof)) {
    throw new UnsafeLocalNetworkError();
  }
}

function probePort(host, port, timeoutMs = 1_500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (reachable) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ host, port, reachable });
    };

    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
}

export function parseFirewallVerificationOutput(output) {
  try {
    const parsed = JSON.parse(String(output ?? "").trim());
    const results = Array.isArray(parsed) ? parsed : [parsed];
    return (
      results.length === FIREWALL_RULES.length &&
      FIREWALL_RULES.every((name) =>
        results.some((result) => result?.name === name && result?.valid === true),
      )
    );
  } catch {
    return false;
  }
}

async function verifyFirewallPolicy() {
  const powershellQuery = String.raw`
$dockerBackend = Get-Process -Name 'com.docker.backend' -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -First 1
$dockerBackendPath = if ($dockerBackend) { $dockerBackend.Path } else { '' }
$names = @(
  'Crimson Crown Local Supabase - Block IPv4 Non-Loopback',
  'Crimson Crown Local Supabase - Block IPv6',
  'Crimson Crown Local Supabase - Docker Backend Block IPv4 Non-Loopback',
  'Crimson Crown Local Supabase - Docker Backend Block IPv6'
)
$results = foreach ($name in $names) {
  $rules = @(Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)
  if ($rules.Count -ne 1) {
    [pscustomobject]@{ name = $name; valid = $false }
    continue
  }
  $rule = $rules[0]
  $portFilter = $rule | Get-NetFirewallPortFilter
  $addressFilter = $rule | Get-NetFirewallAddressFilter
  $applicationFilter = $rule | Get-NetFirewallApplicationFilter
  $isIpv6 = $name -like '*IPv6'
  $expectedAddresses = if ($isIpv6) { @('::/1', '8000::/1') } else { @('0.0.0.0-126.255.255.255', '128.0.0.0-255.255.255.255') }
  $actualAddresses = @($addressFilter.RemoteAddress | ForEach-Object { $_.ToLowerInvariant() } | Sort-Object)
  $normalizedExpected = @($expectedAddresses | ForEach-Object { $_.ToLowerInvariant() } | Sort-Object)
  $addressMatches = (($actualAddresses -join ',') -eq ($normalizedExpected -join ','))
  $programMatches = $true
  if ($name -like '*Docker Backend*') {
    $programMatches = [bool]$dockerBackendPath -and ([string]$applicationFilter.Program -ieq $dockerBackendPath)
  }
  [pscustomobject]@{
    name = $name
    valid = ($rule.Enabled -eq 'True' -and $rule.Direction -eq 'Inbound' -and $rule.Action -eq 'Block' -and [string]$portFilter.Protocol -in @('TCP', '6') -and [string]$portFilter.LocalPort -eq '54620-54629' -and $addressMatches -and $programMatches)
  }
}
@($results) | ConvertTo-Json -Compress
`;

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", powershellQuery],
      { maxBuffer: 16 * 1024, timeout: 15_000, windowsHide: true },
    );
    return parseFirewallVerificationOutput(stdout);
  } catch {
    return false;
  }
}

async function verifyDockerNetworkConfiguration() {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      [
        "network",
        "inspect",
        LOCAL_DOCKER_NETWORK,
        "--format",
        "{{json .Options}}",
      ],
      { maxBuffer: 4 * 1024, timeout: 10_000, windowsHide: true },
    );
    const options = JSON.parse(stdout.trim());
    return (
      options?.["com.docker.network.bridge.host_binding_ipv4"] ===
        "127.0.0.1" &&
      options?.["com.docker.network.enable_ipv6"] === "false"
    );
  } catch {
    return false;
  }
}

async function main() {
  const loopbackResults = await Promise.all(
    LOCAL_SERVICE_PORTS.map((port) => probePort("127.0.0.1", port)),
  );
  const firewallPolicyVerified = await verifyFirewallPolicy();
  const dockerNetworkVerified = await verifyDockerNetworkConfiguration();

  assertNetworkIsolation({
    loopbackResults,
    firewallPolicyVerified,
    dockerNetworkVerified,
  });
  console.log(
    `Aislamiento local verificado en ${LOCAL_SERVICE_PORTS.length} servicios; bridge Docker y firewall no-loopback confirmados.`,
  );
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
