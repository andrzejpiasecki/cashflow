import assert from "node:assert/strict";
import test from "node:test";

import { extractEntriesFromValue, pickActiveEntries } from "./fitssey-entry-balance.ts";

test("odczytuje saldo z pola remain zwracanego przez Fitssey", () => {
  assert.equal(extractEntriesFromValue({ remain: 3 }), 3);
});

test("wybiera najnowszy aktywny karnet i pomija historyczne saldo", () => {
  const rows = [
    { remain: 10, activatedAt: "2026-07-11T00:00:00+02:00", expiresAt: "2026-07-24T23:59:59+02:00" },
    { remain: 2, activatedAt: "2026-08-12T00:00:00+02:00", expiresAt: "2026-11-19T23:59:59+01:00" },
  ];
  assert.equal(pickActiveEntries(rows, new Date("2026-09-24T12:00:00+02:00")), 2);
});

test("zwraca zero, gdy Fitssey zwraca wyłącznie wygasłe karnety", () => {
  assert.equal(pickActiveEntries([
    { remain: 8, activatedAt: "2026-06-01T00:00:00+02:00", expiresAt: "2026-07-01T23:59:59+02:00" },
  ], new Date("2026-09-24T12:00:00+02:00")), 0);
});
