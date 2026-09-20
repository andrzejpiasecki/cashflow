import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

function loadSync({ remoteClients, payload }) {
  const source = fs.readFileSync(
    new URL('../src/lib/fitssey-clients.ts', import.meta.url),
    'utf8',
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const calls = { clientsUpserted: [], contactsUpserted: [], clientsDeleted: [], contactsDeleted: [] };
  const db = {
    fitsseyClient: {
      upsert: async (args) => {
        calls.clientsUpserted.push(args);
        return {};
      },
      updateMany: async () => ({ count: 0 }),
      deleteMany: async (args) => {
        calls.clientsDeleted.push(args);
        return { count: 1 };
      },
    },
    fitsseyClientContact: {
      upsert: async (args) => {
        calls.contactsUpserted.push(args);
        return {};
      },
      updateMany: async () => ({ count: 0 }),
      deleteMany: async (args) => {
        calls.contactsDeleted.push(args);
        return { count: 1 };
      },
    },
  };
  const context = {
    exports: {},
    fetch: async () => ({
      ok: true,
      json: async () => payload ?? ({ collection: remoteClients, pages: 1 }),
    }),
    require: (name) => {
      if (name === '@/lib/db') return { db };
      if (name === '@/lib/shared-scope') return { SHARED_SCOPE_ID: 'shared' };
      throw new Error(`Unexpected import: ${name}`);
    },
    URL,
    Date,
    console,
    encodeURIComponent,
    process,
  };
  vm.runInNewContext(compiled, context);
  return { sync: context.exports.syncFitsseyClientsCache, calls };
}

test('client sync removes cached clients which disappeared from Fitssey', async () => {
  const { sync, calls } = loadSync({
    remoteClients: [
      { guid: 'active-guid', fullName: 'Active Client', phone: '+48123123123' },
    ],
  });

  const result = await sync('studio', 'key');

  assert.deepEqual(JSON.parse(JSON.stringify(calls.clientsDeleted)), [{
    where: { userId: 'shared', externalGuid: { notIn: ['active-guid'] } },
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.contactsDeleted)), [{
    where: { userId: 'shared', clientKey: { notIn: ['active-guid'] } },
  }]);
  assert.equal(result.deleted, 1);
  assert.equal(result.contactsDeleted, 1);
});

test('an empty Fitssey roster clears both client caches', async () => {
  const { sync, calls } = loadSync({ remoteClients: [] });

  await sync('studio', 'key');

  assert.deepEqual(JSON.parse(JSON.stringify(calls.clientsDeleted)), [{ where: { userId: 'shared' } }]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.contactsDeleted)), [{ where: { userId: 'shared' } }]);
});

test('client sync clears a phone removed in Fitssey', async () => {
  const { sync, calls } = loadSync({
    remoteClients: [{ guid: 'active-guid', fullName: 'Active Client' }],
  });

  await sync('studio', 'key');

  assert.equal(calls.clientsUpserted[0].update.phone, null);
  assert.equal(calls.contactsUpserted[0].update.phone, null);
});

test('an unexpected Fitssey response never clears the local client caches', async () => {
  const { sync, calls } = loadSync({ payload: { status: 'ok' } });

  await assert.rejects(sync('studio', 'key'), /format/i);

  assert.equal(calls.clientsDeleted.length, 0);
  assert.equal(calls.contactsDeleted.length, 0);
});
