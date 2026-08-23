import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNetworkIsolation,
  parseFirewallVerificationOutput,
} from "./assert-local-network-isolation.mjs";

const ports = [54621, 54622, 54623, 54624];

const reachableLoopback = ports.map((port) => ({
  host: "127.0.0.1",
  port,
  reachable: true,
}));

const verifiedFirewall = [
  "Crimson Crown Local Supabase - Block IPv4 Non-Loopback",
  "Crimson Crown Local Supabase - Block IPv6",
  "Crimson Crown Local Supabase - Docker Backend Block IPv4 Non-Loopback",
  "Crimson Crown Local Supabase - Docker Backend Block IPv6",
].map((name) => ({ name, valid: true }));

test("acepta loopback operativo con bridge y firewall verificados", () => {
  assert.doesNotThrow(() =>
    assertNetworkIsolation({
      loopbackResults: reachableLoopback,
      firewallPolicyVerified: true,
      dockerNetworkVerified: true,
    }),
  );
});

test("rechaza cualquier control de aislamiento ausente", () => {
  assert.throws(
    () =>
      assertNetworkIsolation({
        loopbackResults: reachableLoopback,
        firewallPolicyVerified: false,
        dockerNetworkVerified: true,
      }),
    /aislamiento de red local no seguro/i,
  );

  assert.throws(
    () =>
      assertNetworkIsolation({
        loopbackResults: reachableLoopback,
        firewallPolicyVerified: true,
        dockerNetworkVerified: false,
      }),
    /aislamiento de red local no seguro/i,
  );
});

test("rechaza pruebas incompletas o un stack local apagado", () => {
  assert.throws(
    () =>
      assertNetworkIsolation({
        loopbackResults: reachableLoopback.map((result) => ({
          ...result,
          reachable: false,
        })),
        firewallPolicyVerified: true,
        dockerNetworkVerified: true,
      }),
    /aislamiento de red local no seguro/i,
  );

  assert.throws(
    () =>
      assertNetworkIsolation({
        loopbackResults: reachableLoopback,
        firewallPolicyVerified: false,
        dockerNetworkVerified: false,
      }),
    /aislamiento de red local no seguro/i,
  );
});

test("interpreta la verificación de firewall sin aceptar reglas incompletas", () => {
  assert.equal(parseFirewallVerificationOutput(JSON.stringify(verifiedFirewall)), true);
  assert.equal(
    parseFirewallVerificationOutput(
      JSON.stringify(verifiedFirewall.slice(0, 3)),
    ),
    false,
  );
  assert.equal(parseFirewallVerificationOutput("not-json"), false);
});
