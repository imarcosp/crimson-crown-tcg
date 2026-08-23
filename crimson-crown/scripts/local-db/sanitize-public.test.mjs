import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("la sanitización cubre las columnas públicas sensibles conocidas", async () => {
  const sql = await readFile(
    new URL("./sanitize-public.sql", import.meta.url),
    "utf8",
  );

  assert.match(sql, /update public\.profiles/iu);
  assert.match(sql, /update public\.orders/iu);
  assert.match(sql, /update public\.import_orders/iu);
  assert.match(sql, /update public\.system_settings/iu);
  assert.match(sql, /contact_email/iu);
  assert.match(sql, /payment_proof_url/iu);
  assert.match(sql, /shipping_address/iu);
  assert.match(sql, /@example\.test/iu);
  assert.doesNotMatch(sql, /crimsoncrownimports\.com/iu);
  assert.doesNotMatch(sql, /djfqozfaqkqdoqeoqbzt/iu);
});
