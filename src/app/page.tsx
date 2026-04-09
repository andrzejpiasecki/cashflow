"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type FlowType = "income" | "expense";

type FlowRow = {
  id: string;
  type: FlowType;
  name: string;
  amount: number;
  startMonth: string;
  disabledMonths: string[];
};

type MonthColumn = {
  key: string;
  label: string;
};

const money = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
  maximumFractionDigits: 0,
});

const MONTH_COUNT = 12;

const initialRows: FlowRow[] = [
  { id: "1", type: "income", name: "Wynagrodzenie", amount: 9600, startMonth: "2026-01", disabledMonths: [] },
  { id: "2", type: "income", name: "Freelance", amount: 1600, startMonth: "2026-03", disabledMonths: ["2026-07"] },
  { id: "3", type: "expense", name: "Czynsz", amount: 2700, startMonth: "2026-01", disabledMonths: [] },
  {
    id: "4",
    type: "expense",
    name: "Ogrzewanie",
    amount: 420,
    startMonth: "2026-01",
    disabledMonths: ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"],
  },
  { id: "5", type: "expense", name: "Internet", amount: 95, startMonth: "2026-01", disabledMonths: [] },
];

export default function Home() {
  const [rows, setRows] = useState<FlowRow[]>(initialRows);
  const [monthOffset, setMonthOffset] = useState(0);

  const months = useMemo(() => getMonthsWindow(monthOffset, MONTH_COUNT), [monthOffset]);
  const incomeRows = useMemo(() => rows.filter((row) => row.type === "income"), [rows]);
  const expenseRows = useMemo(() => rows.filter((row) => row.type === "expense"), [rows]);

  const monthlyTotals = useMemo(
    () =>
      months.map(({ key }) => {
        const income = incomeRows.reduce((sum, row) => sum + getCellValue(row, key), 0);
        const expenses = expenseRows.reduce((sum, row) => sum + getCellValue(row, key), 0);
        return { key, income, expenses, balance: income - expenses };
      }),
    [months, incomeRows, expenseRows],
  );

  const cumulativeBalances = useMemo(() => {
    return monthlyTotals.map((total, index) => ({
      key: total.key,
      value: monthlyTotals.slice(0, index + 1).reduce((sum, month) => sum + month.balance, 0),
    }));
  }, [monthlyTotals]);

  const addRow = (type: FlowType) => {
    const todayMonth = monthKeyFromDate(new Date());
    setRows((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        type,
        name: type === "income" ? "Nowy przychód" : "Nowy wydatek",
        amount: 0,
        startMonth: todayMonth,
        disabledMonths: [],
      },
    ]);
  };

  const updateRow = (id: string, patch: Partial<FlowRow>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const deleteRow = (id: string) => {
    setRows((prev) => prev.filter((row) => row.id !== id));
  };

  const toggleMonth = (rowId: string, month: string) => {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId || compareMonthKeys(month, row.startMonth) < 0) {
          return row;
        }
        const isDisabled = row.disabledMonths.includes(month);
        return {
          ...row,
          disabledMonths: isDisabled
            ? row.disabledMonths.filter((disabledMonth) => disabledMonth !== month)
            : [...row.disabledMonths, month],
        };
      }),
    );
  };

  return (
    <main className="mx-auto flex w-full max-w-[1800px] flex-1 flex-col gap-6 px-4 py-6 sm:px-8">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Cashflow Spreadsheet</h1>
        <p className="text-sm text-muted-foreground">
          Jeden arkusz z podziałem na sekcje. Kliknij komórkę miesiąca, aby wyłączyć/włączyć pozycję dla wybranego
          miesiąca.
        </p>
      </div>

      <section className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <Card>
          <CardHeader>
            <CardTitle>Edycja stałych kosztów i przychodów</CardTitle>
            <CardDescription>
              Nazwę, kwotę i miesiąc startu edytujesz bezpośrednio w wierszu. Możesz dodawać dowolną liczbę wierszy.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={() => setMonthOffset((prev) => prev - 1)}>
                <ChevronLeft className="mr-1 h-4 w-4" />
                Poprzedni
              </Button>
              <Button variant="ghost" onClick={() => setMonthOffset((prev) => prev + 1)}>
                Następny
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
              <Button variant="ghost" onClick={() => setMonthOffset(0)}>
                Dziś
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Arkusz miesięczny</CardTitle>
          <CardDescription>Sekcje: Przychody i Wydatki w jednej tabeli.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[200px]">Nazwa</TableHead>
                <TableHead className="min-w-[110px] text-right">Kwota</TableHead>
                <TableHead className="min-w-[120px]">Start</TableHead>
                {months.map((month) => (
                  <TableHead key={month.key} className="text-right text-xs">
                    {month.label}
                  </TableHead>
                ))}
                <TableHead className="text-right">Suma</TableHead>
                <TableHead className="w-[56px] text-right">Akcja</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <SectionHeader title="PRZYCHODY" />
              {incomeRows.map((row) => (
                <SpreadsheetRow
                  key={row.id}
                  row={row}
                  months={months}
                  onUpdate={updateRow}
                  onToggleMonth={toggleMonth}
                  onDelete={deleteRow}
                />
              ))}
              <SectionAddRow label="+ Dodaj przychód" onClick={() => addRow("income")} colSpan={months.length + 5} />

              <SectionHeader title="WYDATKI" />
              {expenseRows.map((row) => (
                <SpreadsheetRow
                  key={row.id}
                  row={row}
                  months={months}
                  onUpdate={updateRow}
                  onToggleMonth={toggleMonth}
                  onDelete={deleteRow}
                />
              ))}
              <SectionAddRow label="+ Dodaj wydatek" onClick={() => addRow("expense")} colSpan={months.length + 5} />
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3} className="font-semibold">
                  Miesięczne saldo
                </TableCell>
                {monthlyTotals.map((total) => (
                  <TableCell
                    key={total.key}
                    className={`text-right font-semibold ${total.balance >= 0 ? "text-emerald-700" : "text-rose-700"}`}
                  >
                    {money.format(total.balance)}
                  </TableCell>
                ))}
                <TableCell className="text-right font-semibold">
                  {money.format(monthlyTotals.reduce((sum, total) => sum + total.balance, 0))}
                </TableCell>
                <TableCell />
              </TableRow>
              <TableRow>
                <TableCell colSpan={3} className="font-semibold">
                  Stan skumulowany
                </TableCell>
                {cumulativeBalances.map((entry) => (
                  <TableCell
                    key={entry.key}
                    className={`text-right font-semibold ${entry.value >= 0 ? "text-emerald-700" : "text-rose-700"}`}
                  >
                    {money.format(entry.value)}
                  </TableCell>
                ))}
                <TableCell className="text-right font-semibold">
                  {money.format(cumulativeBalances.at(-1)?.value ?? 0)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}

type SpreadsheetRowProps = {
  row: FlowRow;
  months: MonthColumn[];
  onUpdate: (id: string, patch: Partial<FlowRow>) => void;
  onToggleMonth: (rowId: string, month: string) => void;
  onDelete: (id: string) => void;
};

function SpreadsheetRow({ row, months, onUpdate, onToggleMonth, onDelete }: SpreadsheetRowProps) {
  const rowTotal = months.reduce((sum, month) => sum + getCellValue(row, month.key), 0);
  const toneClass = row.type === "income" ? "text-emerald-700" : "text-rose-700";

  return (
    <TableRow>
      <TableCell>
        <Input value={row.name} onChange={(event) => onUpdate(row.id, { name: event.target.value })} />
      </TableCell>
      <TableCell className="text-right">
        <Input
          type="number"
          step="0.01"
          min="0"
          value={row.amount}
          onChange={(event) => onUpdate(row.id, { amount: Number(event.target.value) || 0 })}
          className="text-right"
        />
      </TableCell>
      <TableCell>
        <Input
          type="month"
          value={row.startMonth}
          onChange={(event) => onUpdate(row.id, { startMonth: event.target.value })}
        />
      </TableCell>
      {months.map((month) => {
        const value = getCellValue(row, month.key);
        const hasStarted = compareMonthKeys(month.key, row.startMonth) >= 0;
        return (
          <TableCell key={month.key} className="p-1 text-right">
            <button
              type="button"
              disabled={!hasStarted}
              className={`h-8 min-w-[90px] rounded-md border px-2 text-xs ${
                !hasStarted
                  ? "cursor-not-allowed border-transparent bg-transparent text-slate-300"
                  : value > 0
                    ? "border-transparent bg-emerald-100 text-slate-800"
                    : "border-dashed border-slate-300 bg-slate-50 text-slate-400"
              }`}
              onClick={() => onToggleMonth(row.id, month.key)}
            >
              {!hasStarted ? "—" : value > 0 ? money.format(value) : "wył."}
            </button>
          </TableCell>
        );
      })}
      <TableCell className={`text-right font-semibold ${toneClass}`}>{money.format(rowTotal)}</TableCell>
      <TableCell className="text-right">
        <Button variant="ghost" className="h-8 px-2 text-muted-foreground hover:text-rose-700" onClick={() => onDelete(row.id)}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <TableRow className="bg-slate-100/70 hover:bg-slate-100/70">
      <TableCell colSpan={999} className="py-2 text-xs font-semibold tracking-[0.08em] text-slate-600">
        {title}
      </TableCell>
    </TableRow>
  );
}

function SectionAddRow({ label, onClick, colSpan }: { label: string; onClick: () => void; colSpan: number }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan}>
        <Button variant="ghost" className="h-8 px-2 text-primary" onClick={onClick}>
          {label}
        </Button>
      </TableCell>
    </TableRow>
  );
}

function getCellValue(row: FlowRow, month: string) {
  const hasStarted = compareMonthKeys(month, row.startMonth) >= 0;
  const isDisabled = row.disabledMonths.includes(month);
  return hasStarted && !isDisabled ? row.amount : 0;
}

function compareMonthKeys(left: string, right: string) {
  return left.localeCompare(right);
}

function monthKeyFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthsWindow(offset: number, count: number): MonthColumn[] {
  const start = new Date();
  start.setDate(1);
  start.setMonth(start.getMonth() + offset);

  return Array.from({ length: count }, (_, index) => {
    const monthDate = new Date(start.getFullYear(), start.getMonth() + index, 1);
    const key = monthKeyFromDate(monthDate);
    return { key, label: formatMonthLabel(key) };
  });
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  return `${month}/${year}`;
}
