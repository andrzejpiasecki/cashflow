import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';

function mount({ responses, hidden = false, recentCheck = false }) {
  const effects = [], events = [], listeners = new Map(), storage = new Map();
  let now = Date.now();
  class ClockDate extends Date { static now() { return now; } }
  if (recentCheck) storage.set('fitssey_auto_import_last_checked_at', String(Date.now()));
  const requestBodies = [], documentListeners = new Map();
  let requests = 0, tick, cleanup;
  const window = {
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    setInterval: (fn, ms) => { tick = fn; assert.equal(ms, 60_000); return 1; }, clearInterval: () => {},
    addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: (key) => listeners.delete(key),
    dispatchEvent: (event) => events.push(event.type),
  };
  const document = { visibilityState: hidden ? 'hidden' : 'visible', addEventListener: (key, fn) => documentListeners.set(key, fn), removeEventListener: (key) => documentListeners.delete(key) };
  const source = fs.readFileSync(new URL('../src/components/app-shell.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = { exports: {}, window, document, Date: ClockDate, CustomEvent: class { constructor(type) { this.type = type; } },
    fetch: async (_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      const response = responses[requests++];
      if (response instanceof Error) throw response;
      return { ok: response.ok ?? true, json: async () => response };
    },
    require: (name) => {
      if (name === 'react') return { useEffect: (effect) => effects.push(effect) };
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (name === 'next/navigation') return { usePathname: () => '/dashboard' };
      if (name === '@clerk/nextjs') return { useAuth: () => ({ isLoaded: true, isSignedIn: true }) };
      return {};
    },
  };
  vm.runInNewContext(compiled, context);
  context.exports.AppShell({ title: 'Test', children: null });
  cleanup = effects[0]();
  return { events, storage, listeners, documentListeners, requestBodies, document, advance: (ms) => { now += ms; }, tick: () => tick(), cleanup, get requests() { return requests; } };
}
const flush = () => new Promise(setImmediate);

test('successful automatic refresh updates views and broadcasts freshness to other tabs', async () => {
  const app = mount({ responses: [{ lastImportedAt: '2026-10-05T12:00:00Z' }] });
  await flush();
  assert.equal(app.requests, 1);
  assert.deepEqual(app.events, ['fitssey:auto-import-completed']);
  assert.equal(app.storage.get('fitssey_auto_import_completed_at'), '2026-10-05T12:00:00Z');
  app.listeners.get('storage')({ key: 'fitssey_auto_import_completed_at', newValue: 'new' });
  assert.equal(app.events.length, 2);
  app.cleanup();
});

test('failed refresh is retried without waiting for the successful-check throttle', async () => {
  const app = mount({ responses: [new Error('offline'), { lastImportedAt: 'new' }] });
  await flush();
  assert.equal(app.storage.has('fitssey_auto_import_last_checked_at'), false);
  app.tick();
  await flush();
  assert.equal(app.requests, 2);
  assert.equal(app.events.length, 1);
  app.cleanup();
});

test('an import completed on another device refreshes views even if this check is skipped', async () => {
  const app = mount({ responses: [{ skipped: true, lastImportedAt: 'new' }] });
  await flush();
  assert.equal(app.events.length, 1);
  app.cleanup();
});

test('hidden tabs wait until focus before checking Fitssey', async () => {
  const app = mount({ hidden: true, responses: [{ lastImportedAt: 'new' }] });
  await flush();
  assert.equal(app.requests, 0);
  app.document.visibilityState = 'visible';
  app.listeners.get('focus')();
  await flush();
  assert.equal(app.requests, 1);
  app.cleanup();
});


test('opening Cashflow bypasses the recent client check and requests a foreground import', async () => {
  const app = mount({ recentCheck: true, responses: [{ lastImportedAt: 'fresh' }] });
  await flush();
  assert.equal(app.requests, 1);
  assert.equal(app.requestBodies[0].trigger, 'foreground');
  app.cleanup();
});

test('resuming the PWA refreshes immediately despite a recent successful check', async () => {
  const app = mount({ hidden: true, recentCheck: true, responses: [{ lastImportedAt: 'fresh' }] });
  app.document.visibilityState = 'visible';
  app.documentListeners.get('visibilitychange')();
  await flush();
  assert.equal(app.requests, 1);
  assert.equal(app.requestBodies[0].trigger, 'foreground');
  app.cleanup();
});


test('reopening an already running PWA bypasses five-minute polling and coalesces resume events', async () => {
  const app = mount({ responses: [{ lastImportedAt: 'before-purchase' }, { lastImportedAt: 'after-purchase' }] });
  await flush();
  app.advance(2000);
  app.document.visibilityState = 'hidden';
  app.documentListeners.get('visibilitychange')();
  app.document.visibilityState = 'visible';
  app.documentListeners.get('visibilitychange')();
  app.listeners.get('focus')();
  app.listeners.get('pageshow')({ persisted: true });
  await flush();
  assert.equal(app.requests, 2);
  assert.equal(app.requestBodies[1].trigger, 'foreground');
  assert.equal(app.events.length, 2);
  app.cleanup();
});

test('regular timer checks keep the interval trigger after the PWA opens', async () => {
  const app = mount({ responses: [{ lastImportedAt: 'fresh' }, { skipped: true }] });
  await flush();
  app.tick();
  assert.equal(app.requests, 1);
  app.advance(60_000);
  app.tick();
  await flush();
  assert.equal(app.requests, 2);
  assert.equal(app.requestBodies[1].trigger, 'interval');
  app.cleanup();
});
