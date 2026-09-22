import assert from "node:assert/strict";
import test from "node:test";

import { getHistoryLeadStage } from "./lead-stage.ts";

const client = { name: "Anna Kowalska", clientGuid: "client-1" };

test("historia pokazuje domyślny status leada ze Sprzedaży", () => {
  assert.equal(getHistoryLeadStage({}, client, { priority: "wysoki", activeEntries: null }), "new");
});

test("ręcznie ustawiony status ma pierwszeństwo", () => {
  assert.equal(getHistoryLeadStage({ "client-1": "won" }, client, { priority: "wysoki", activeEntries: null }), "won");
});

test("klient bez leada i bez zapisanego statusu pozostaje bez statusu", () => {
  assert.equal(getHistoryLeadStage({}, client), "");
});
