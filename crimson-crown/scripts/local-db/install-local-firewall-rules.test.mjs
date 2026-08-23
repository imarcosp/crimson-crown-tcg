import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("el instalador de firewall queda limitado al rango local de Crimson", async () => {
  const script = await readFile(
    new URL("./install-local-firewall-rules.ps1", import.meta.url),
    "utf8",
  );

  assert.match(script, /54620-54629/u);
  assert.match(
    script,
    /Crimson Crown Local Supabase - Block IPv4 Non-Loopback/u,
  );
  assert.match(script, /Crimson Crown Local Supabase - Block IPv6/u);
  assert.match(script, /com\.docker\.backend/u);
  assert.match(script, /Get-Process/u);
  assert.match(script, /ProgramPath/u);
  assert.match(script, /'::\/1'/u);
  assert.match(script, /'8000::\/1'/u);
  assert.doesNotMatch(script, /'::\/0'/u);
  assert.match(script, /WindowsBuiltInRole\]::Administrator/u);
  assert.match(script, /New-NetFirewallRule/u);
  assert.doesNotMatch(script, /Remove-NetFirewallRule/u);
  assert.doesNotMatch(script, /Set-NetFirewallProfile/u);
  assert.doesNotMatch(script, /LocalPort\s+Any/u);
});
