import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

function loadImport({ malformed = false, remoteRows, settingsOverride = {}, claimCount = 1 } = {}) {
  const calls = { urls: [], deletes: [], flows: [], flowDeletes: [], statuses: [], stored: [] };
  const settings = { id: 'settings', userId: 'shared', studioUuid: 'studio', apiKey: 'test', startDate: new Date('2025-10-01'), lastImportedAt: new Date('2026-09-30'), autoImportEnabled: true, autoImportIntervalMins: 1, updatedAt: new Date(0), lastImportStatus: 'ok', ...settingsOverride };
  const db = {
    fitsseySettings: { findUnique: async () => settings, updateMany: async (args) => { calls.statuses.push(args); return { count: claimCount }; } },
    fitsseySale: { findMany: async () => calls.stored, deleteMany: async (args) => { calls.deletes.push(args); calls.stored = []; }, createMany: async (args) => { calls.stored.push(...args.data); } },
    flowRow: {
      findMany: async () => [{ id: 'flow', name: 'Pass', createdAt: new Date(0), monthValues: { '2026-08': 100, '2026-09': 200 } }],
      update: async (args) => { calls.flows.push(args); }, create: async () => {}, deleteMany: async (args) => { calls.flowDeletes.push(args); return { count: 0 }; },
    },
    $transaction: async (fn) => fn(db),
  };
  const source = fs.readFileSync(new URL('../src/app/api/fitssey/import/route.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-05T12:00:00Z'])); }
    static now() { return new Date('2026-10-05T12:00:00Z').getTime(); }
  }
  const context = { exports: {}, Date: FixedDate, URL, AbortSignal, process, console, setTimeout,
    fetch: async (url) => { calls.urls.push(url); return { ok: true, json: async () => malformed ? { status: 'ok' } : { pages: 1, collection: remoteRows ?? [{ saleDate: '2026-10-05', itemName: 'Pass', itemTotalPrice: 30000 }] } }; },
    require: (name) => {
      if (name === 'next/server') return { NextResponse: { json: (body, init) => ({ body, status: init?.status ?? 200 }) } };
      if (name === '@clerk/nextjs/server') return { auth: async () => ({ userId: 'user' }) };
      if (name === '@/lib/db') return { db };
      if (name === '@/lib/shared-scope') return { SHARED_SCOPE_ID: 'shared' };
      if (name === '@/lib/fitssey-clients') return { syncFitsseyClientEntriesForUsers: async () => ({ checked: 0, updated: 0 }) };
      throw new Error(`Unexpected import ${name}`);
    },
  };
  vm.runInNewContext(compiled, context);
  return { run: (body = { auto: true }) => context.exports.POST({ json: async () => body }), calls };
}

test('refresh fetches an overlapping recent window and keeps older cashflow history', async () => {
  const { run, calls } = loadImport();
  const result = await run();
  assert.equal(result.status, 200);
  assert.match(calls.urls[0], /startDate=2026-09-01/);
  assert.equal(calls.deletes[0].where.saleDayKey.gte, '2026-09-01');
  assert.equal(calls.flows[0].data.monthValues['2026-08'], 100);
  assert.equal(calls.flows[0].data.monthValues['2026-09'], undefined);
  assert.equal(calls.flows[0].data.monthValues['2026-10'], 300);
});

test('unexpected sales response fails before deleting cached sales', async () => {
  const { run, calls } = loadImport({ malformed: true });
  const result = await run();
  assert.equal(result.status, 500);
  assert.equal(calls.deletes.length, 0);
});


test('first import and explicit full refresh fetch the configured history', async () => {
  for (const opts of [{ settingsOverride: { lastImportedAt: null } }, {}]) {
    const { run, calls } = loadImport(opts);
    const result = await run({ full: true });
    assert.equal(result.status, 200);
    assert.match(calls.urls[0], /startDate=2025-10-01/);
    assert.equal(calls.deletes[0].where.saleDayKey, undefined);
    assert.equal(calls.flows[0].data.monthValues['2026-08'], undefined);
  }
});

test('empty recent window removes cancelled purchases but retains historical income', async () => {
  const { run, calls } = loadImport({ remoteRows: [] });
  const result = await run();
  assert.equal(result.status, 200);
  assert.equal(calls.stored.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.flows[0].data.monthValues)), { '2026-08': 100 });
});

test('empty full import clears stale imported products', async () => {
  const { run, calls } = loadImport({ remoteRows: [] });
  assert.equal((await run({ full: true })).status, 200);
  assert.equal(calls.flows.length, 0);
  assert.equal(calls.flowDeletes.length, 1);
});

test('atomic lock prevents both manual and automatic competing imports', async () => {
  for (const body of [{ auto: true }, {}]) {
    const { run, calls } = loadImport({ claimCount: 0 });
    const result = await run(body);
    assert.equal(result.body.reason, 'already_running');
    assert.equal(calls.urls.length, 0);
    assert.equal(calls.statuses.length, 1);
  }
});

test('repeated overlapping imports preserve two identical real purchases without accumulating duplicates', async () => {
  const sale = { saleDate: '2026-10-05', itemName: 'Pass', itemTotalPrice: 30000 };
  const { run, calls } = loadImport({ remoteRows: [sale, sale] });
  await run();
  await run();
  assert.equal(calls.stored.length, 2);
  assert.equal(calls.flows.at(-1).data.monthValues['2026-10'], 600);
});

test('automatic import observes the server interval and reports cached freshness', async () => {
  const { run, calls } = loadImport({ settingsOverride: { lastImportedAt: new Date('2026-10-05T11:58:00Z'), autoImportIntervalMins: 180 } });
  const result = await run();
  assert.equal(result.body.reason, 'too_soon');
  assert.equal(result.body.nextAllowedAt, '2026-10-05T12:03:00.000Z');
  assert.equal(result.body.lastImportedAt, '2026-10-05T11:58:00.000Z');
  assert.equal(calls.urls.length, 0);
});


test('unchanged overlapping sales keep their cached IDs and avoid delete/create churn', async () => {
  const { run, calls } = loadImport();
  await run();
  calls.stored[0].id = 'stable-sale-id';
  await run();
  assert.equal(calls.deletes.length, 1);
  assert.equal(calls.stored[0].id, 'stable-sale-id');
});


test('foreground launch imports a new purchase even when the last sync was seconds ago', async () => {
  const { run, calls } = loadImport({ settingsOverride: { lastImportedAt: new Date('2026-10-05T11:59:55Z'), autoImportIntervalMins: 5 } });
  const result = await run({ auto: true, trigger: 'foreground' });
  assert.equal(result.status, 200);
  assert.equal(result.body.skipped, false);
  assert.equal(result.body.mode, 'incremental');
  assert.equal(calls.stored.length, 1);
});

test('foreground refresh still respects a running import and disabled synchronization', async () => {
  for (const [settingsOverride, reason] of [
    [{ autoImportEnabled: false }, 'auto_disabled'],
    [{ lastImportStatus: 'running: auto import', updatedAt: new Date('2026-10-05T11:59:55Z') }, 'already_running'],
  ]) {
    const { run, calls } = loadImport({ settingsOverride });
    const result = await run({ auto: true, trigger: 'foreground' });
    assert.equal(result.body.reason, reason);
    assert.equal(calls.urls.length, 0);
  }
});
