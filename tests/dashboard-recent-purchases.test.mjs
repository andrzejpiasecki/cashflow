import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';

function loadSource(path, appended, requireModule) {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(`${source}\n${appended}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const context = { exports: {}, require: requireModule };
  vm.runInNewContext(compiled, context);
  return context.exports;
}

const { buildRecentPurchases } = loadSource('../src/app/api/fitssey/dashboard/route.ts',
  'exports.buildRecentPurchases = buildRecentPurchases;', () => ({}));
const tableNames = ['Table', 'TableBody', 'TableCell', 'TableHead', 'TableHeader', 'TableRow'];
const { RecentPurchasesTable } = loadSource('../src/app/dashboard/page.tsx',
  'exports.RecentPurchasesTable = RecentPurchasesTable;', (name) => {
    if (name === 'react/jsx-runtime') return jsxRuntime;
    if (name === 'react') return { useState: (value) => [value, () => {}] };
    if (name === '@/components/ui/table') return Object.fromEntries(tableNames.map((key) => [key, key]));
    return {};
  });

function childrenOfType(node, type) {
  if (Array.isArray(node)) return node.flatMap((child) => childrenOfType(child, type));
  if (!node || typeof node !== 'object') return [];
  if (node.type === type) return [node];
  return childrenOfType(node.props?.children, type);
}

test('separate sales with matching display fields get distinct recent purchase row keys', () => {
  const sale = {
    id: 'sale-1', date: new Date('2026-09-23T22:00:00Z'), month: '2026-09', dayKey: '2026-09-24',
    clientName: 'Beata Bajor', clientKey: 'beata', clientGuid: 'beata', clientUuid: null,
    clientEmail: null, clientPhone: null, product: 'Karnet 4 wejść na zajęcia grupowe Reformer',
    amount: 100, isPass: true, passActivatedDayKey: null, passExpiresDayKey: null,
  };
  const rows = buildRecentPurchases([sale, { ...sale, id: 'sale-2' }], [], []);
  const body = childrenOfType(RecentPurchasesTable({ rows }), 'TableBody')[0];
  const renderedRows = childrenOfType(body.props.children, 'TableRow');
  assert.equal(renderedRows.length, 2);
  assert.deepEqual(Array.from(renderedRows, (row) => row.key), ['sale-1', 'sale-2']);
});
