import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const smsSource = fs.readFileSync(new URL('../src/lib/sales-sms.ts', import.meta.url), 'utf8');
const smsContext = { exports: {} };
vm.runInNewContext(ts.transpileModule(smsSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, smsContext);

// Exercise the dashboard calculation without authentication or a database.
const source = fs.readFileSync(new URL('../src/app/api/fitssey/dashboard/route.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(`${source}\nexports.buildAnalytics = buildAnalytics;`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-09-14T12:00:00Z'])); }
  static now() { return new Date('2026-09-14T12:00:00Z').getTime(); }
}
const context = { exports: {}, require: () => ({}), Date: FixedDate };
vm.runInNewContext(compiled, context);
const { buildAnalytics } = context.exports;

function contacts(activeEntries, withContact = true, passExpiresDayKey = null, collection = "contacts") {
  const sale = {
    date: new Date('2026-07-15T12:00:00Z'), month: '2026-07', dayKey: '2026-07-15',
    clientName: 'Kramer', clientKey: 'kramer', clientGuid: 'kramer', clientUuid: null,
    clientEmail: null, clientPhone: null, product: 'Karnet 24 wejścia', amount: 1800,
    isPass: true, passActivatedDayKey: null, passExpiresDayKey,
  };
  const cached = { externalGuid: 'kramer', clientUuid: null, normalizedName: 'kramer', email: null, phone: null, activeEntries };
  const contact = { clientKey: sale.clientKey, clientGuid: 'kramer', clientUuid: null, normalizedName: 'kramer', email: null, phone: null };
  return buildAnalytics([
    sale,
    { ...sale, date: new Date('2026-09-10T12:00:00Z'), month: '2026-09', dayKey: '2026-09-10', clientKey: 'other', clientGuid: 'other', clientName: 'Other' },
  ], [cached], withContact ? [contact] : [])[collection];
}

test('an active 24-entry pass is not an unrenewed lead when a contact cache exists', () => {
  assert.equal(contacts(12).some((lead) => lead.name === 'Kramer'), false);
});
test('an active pass without a contact cache is not a lead', () => {
  assert.equal(contacts(12, false).some((lead) => lead.name === 'Kramer'), false);
});
test('one remaining entry produces the last-entry reminder', () => {
  const lead = contacts(1).find((lead) => lead.name === 'Kramer');
  assert.equal(lead?.activeEntries, 1);
  assert.match(lead.reason, /Ostatnie wejscie/);
});
test('an exhausted pass remains eligible for renewal', () => {
  const lead = contacts(0).find((lead) => lead.name === 'Kramer');
  assert.equal(lead?.activeEntries, 0);
  assert.match(lead.reason, /nie zostal odnowiony/);
});

test('Kramer with unknown remaining entries and a valid 24-entry pass is not a lead', () => {
  assert.equal(contacts(null, true, '2026-11-19').some((lead) => lead.name === 'Kramer'), false);
});
test('a pass remains valid through its expiration day in Warsaw', () => {
  assert.equal(contacts(null, true, '2026-09-14').some((lead) => lead.name === 'Kramer'), false);
});
test('an expired pass with unknown entries remains eligible for renewal', () => {
  assert.equal(contacts(null, true, '2026-09-13').some((lead) => lead.name === 'Kramer'), true);
});
test('known exhaustion takes precedence over a future expiration date', () => {
  assert.equal(contacts(0, true, '2026-11-19').some((lead) => lead.name === 'Kramer'), true);
});


test('a client with 70 days of pass validity remains available in client search', () => {
  const client = contacts(null, true, '2026-11-23', 'salesClients')?.find((row) => row.name === 'Kramer');
  assert.ok(client, 'active clients must remain searchable');
  assert.equal(client.hasActivePass, true);
  assert.equal(client.passDaysRemaining, 70);
  assert.equal(client.passExpiresDayKey, '2026-11-23');
  assert.equal(client.passProduct, 'Karnet 24 wejścia');
});


test('search renders the active client and remaining validity even with no leads', () => {
  const page = fs.readFileSync(new URL('../src/app/sales/page.tsx', import.meta.url), 'utf8');
  const js = ts.transpileModule(page, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const state = [
    { contacts: [], salesClients: contacts(null, true, '2026-11-23', 'salesClients').map((client) => ({ ...client, phone: '+48 123 456 789' })), smsTemplates: [
      { id: 'welcome', label: 'Powitalny', message: 'Witaj {imie}' },
      { id: 'renewal', label: 'Odnowienie', message: 'Cześć {imię}, zapraszamy!' },
    ] },
    '', false, 'kramer', 'all', 'all', '', '', '', '', [], [], 'renewal', {}, null,
  ];
  let index = 0;
  const pageContext = {
    exports: {},
    require: (name) => {
      if (name === '@/lib/sales-sms') return smsContext.exports;
      if (name === 'react') return { ...React, useState: () => [state[index++], () => {}], useMemo: (fn) => fn(), useEffect: () => {} };
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (name === '@/components/app-shell') return { AppShell: ({ children }) => children };
      if (name === '@/components/ui/table') return Object.fromEntries(['Table', 'TableBody', 'TableCell', 'TableHead', 'TableHeader', 'TableRow'].map((key) => [key, ({ children }) => React.createElement('div', null, children)]));
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  vm.runInNewContext(js, pageContext);
  const html = renderToStaticMarkup(React.createElement(pageContext.exports.default));
  assert.match(html, /Kramer/);
  assert.match(html, /Aktywny karnet/);
  assert.match(html, /70 dni do końca ważności karnetu/);
  assert.doesNotMatch(html, /Other/);
  assert.match(html, /Wysyłka grupowa SMS/);
  assert.match(html, /Typ SMS-a/);
  assert.doesNotMatch(html, /SMS z szablonu/);

});
