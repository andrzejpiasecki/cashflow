import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import * as jsxRuntime from 'react/jsx-runtime';

const source = fs.readFileSync(new URL('../src/app/cashflow/page.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-09-29T12:00:00Z'])); }
}

function row(name, monthValues, isImported = false, type = 'income') {
  return { id: name, name, monthValues, isImported, type, vatRate: null, amount: 0, startMonth: '2026-01', endMonth: null };
}

// Run the page's real memo calculations and inspect the values passed to its summary rows.
function summaries(rows, forecast = 18971, anchored = false) {
  let stateIndex = 0;
  const stateOverrides = new Map([[0, rows], [4, false], [12, forecast], [15, anchored]]);
  const context = {
    exports: {}, Date: FixedDate,
    require(name) {
      if (name === 'react/jsx-runtime') return jsxRuntime;
      if (name === 'react') return {
        useEffect() {}, useRef: (value) => ({ current: value }), useMemo: (calculate) => calculate(),
        useState(value) { const index = stateIndex++; return [stateOverrides.has(index) ? stateOverrides.get(index) : value, () => {}]; },
      };
      if (name === '@clerk/nextjs') return { useAuth: () => ({ isLoaded: true, isSignedIn: true }) };
      return new Proxy({}, { get: (_, key) => String(key) });
    },
  };
  vm.runInNewContext(compiled, context);
  const result = new Map();
  function visit(element) {
    if (Array.isArray(element)) { element.forEach(visit); return; }
    if (!element?.props) return;
    if (element.props.label && element.props.values && element.props.monthKeys) {
      result.set(element.props.label, new Map(element.props.monthKeys.map((key, index) => [key, element.props.values[index]])));
    }
    visit(element.props.children);
  }
  visit(context.exports.default());
  return result;
}

test('the total forecast includes manually entered income from the screenshot', () => {
  const values = summaries([
    row('Fitssey', { '2026-01': 18654, '2026-02': 15231, '2026-03': 25064, '2026-04': 25679, '2026-05': 27920, '2026-06': 17601, '2026-07': 23042, '2026-08': 17476, '2026-09': 17295 }, true),
    row('Zwrot VAT', { '2026-05': 17000 }),
    row('Trening personalny 1', { '2026-08': 1300, '2026-09': 600 }),
    row('Trening personalny 2', { '2026-09': 2000 }),
    row('Wydatki', { '2026-09': 18000 }, false, 'expense'),
  ]);
  const forecast = values.get('Prognoza przychodów (auto)');
  assert.equal(forecast.get('2026-05'), 44920);
  assert.equal(forecast.get('2026-08'), 18776);
  assert.equal(forecast.get('2026-09'), 21571);
  assert.equal(values.get('Miesięczne przychody').get('2026-09'), 19895);
  assert.equal(values.get('Zysk').get('2026-09'), 3571);
});

test('a manual income is included even without any Fitssey revenue', () => {
  assert.equal(summaries([row('Gotówka', { '2026-08': 1300 })]).get('Prognoza przychodów (auto)').get('2026-08'), 1300);
});

test('manual income is added once without inflating the Fitssey historical baseline', () => {
  const imported = row('Fitssey', { '2026-06': 1000, '2026-07': 2000, '2026-08': 3000, '2026-09': 1500 }, true);
  const base = summaries([imported]);
  const values = summaries([imported, row('Gotówka', { '2026-08': 1300, '2026-10': 600 })]);
  const forecast = values.get('Prognoza przychodów (auto)');
  assert.equal(forecast.get('2026-10'), 2600);
  assert.equal(forecast.get('2026-11'), base.get('Prognoza przychodów (auto)').get('2026-11'));
  assert.equal(values.get('Miesięczne przychody').get('2026-10'), 2600);
  assert.equal(values.get('Zysk').get('2026-10'), 2600);
});

test('the fallback current-month forecast includes manual income', () => {
  const values = summaries([
    row('Fitssey', { '2026-09': 1500 }, true),
    row('Gotówka', { '2026-09': 600 }),
  ], null);
  assert.equal(values.get('Prognoza przychodów (auto)').get('2026-09'), 2100);
});

test('an anchored account balance is excluded consistently from revenue and its forecast', () => {
  const values = summaries([
    row('Fitssey', { '2026-08': 1000 }, true),
    row('Stan konta', { '2026-08': 50000 }),
    row('Gotówka', { '2026-08': 600 }),
  ], 18971, true);
  assert.equal(values.get('Prognoza przychodów (auto)').get('2026-08'), 1600);
  assert.equal(values.get('Miesięczne przychody').get('2026-08'), 1600);
});
