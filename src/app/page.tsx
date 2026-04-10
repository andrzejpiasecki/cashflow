"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { UserButton } from "@clerk/nextjs";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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
  endMonth: string | null;
  monthValues: Record<string, number>;
};

type MonthColumn = {
  key: string;
  label: string;
};

const money = new Intl.NumberFormat("pl-PL", {
  style: "decimal",
  maximumFractionDigits: 0,
});

export default function Home() {
  const [rows, setRows] = useState<FlowRow[]>([]);
  const rowsRef = useRef<FlowRow[]>([]);
  const [yearOffset, setYearOffset] = useState(0);
  const [citRate, setCitRate] = useState(19);
  const [vatRate, setVatRate] = useState(23);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadRows = async () => {
      try {
        const response = await fetch("/api/flow-rows");
        if (!response.ok) return;
        const data = (await response.json()) as FlowRow[];
        setRows(data);
        rowsRef.current = data;
      } finally {
        setIsLoading(false);
      }
    };
    void loadRows();
  }, []);

  const months = useMemo(() => getYearMonthsWindow(yearOffset), [yearOffset]);
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

  const taxTotals = useMemo(
    () => {
      const vatAccrual = monthlyTotals.map((total) => total.income * (vatRate / 100) - total.expenses * (vatRate / 100));

      return monthlyTotals.map((total, index) => {
        const taxableIncome = Math.max(total.balance, 0);
        const cit = taxableIncome * (citRate / 100);
        const isSettlementMonth = isQuarterSettlementMonth(total.key);

        const previousSettlementIndex = monthlyTotals
          .slice(0, index)
          .map((month, monthIndex) => (isQuarterSettlementMonth(month.key) ? monthIndex : -1))
          .filter((monthIndex) => monthIndex >= 0)
          .at(-1);

        const rangeStart = previousSettlementIndex === undefined ? 0 : previousSettlementIndex + 1;
        const vatPayment = isSettlementMonth
          ? vatAccrual.slice(rangeStart, index + 1).reduce((sum, amount) => sum + amount, 0)
          : 0;

        return { key: total.key, cit, vatPayment };
      });
    },
    [monthlyTotals, citRate, vatRate],
  );

  const cumulativeNetAfterTax = useMemo(() => {
    return monthlyTotals.map((total, index) => {
      const monthNet = total.balance - taxTotals[index].cit - taxTotals[index].vatPayment;
      const previous = index === 0
        ? 0
        : monthlyTotals
            .slice(0, index)
            .reduce(
              (sum, month, monthIndex) => sum + month.balance - taxTotals[monthIndex].cit - taxTotals[monthIndex].vatPayment,
              0,
            );
      return { key: total.key, value: previous + monthNet };
    });
  }, [monthlyTotals, taxTotals]);

  const addRow = (type: FlowType) => {
    const todayMonth = monthKeyFromDate(new Date());
    const draft = {
      id: crypto.randomUUID(),
      type,
      name: type === "income" ? "Nowy przychód" : "Nowy wydatek",
      amount: 0,
      startMonth: todayMonth,
      endMonth: null,
      monthValues: {},
    } satisfies FlowRow;

    const nextRows = [...rowsRef.current, draft];
    rowsRef.current = nextRows;
    setRows(nextRows);

    void fetch("/api/flow-rows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((saved: FlowRow | null) => {
        if (!saved) return;
        const replaced = rowsRef.current.map((row) => (row.id === draft.id ? saved : row));
        rowsRef.current = replaced;
        setRows(replaced);
      });
  };

  const updateRow = (id: string, patch: Partial<FlowRow>) => {
    let patchForServer: Partial<FlowRow> = patch;
    const nextRows = rowsRef.current.map((row) => {
      if (row.id !== id) return row;

      const shouldOverrideMonthlyEdits =
        patch.amount !== undefined || patch.startMonth !== undefined || patch.endMonth !== undefined;

      if (!shouldOverrideMonthlyEdits) {
        return { ...row, ...patch };
      }

      patchForServer = { ...patch, monthValues: {} };
      return { ...row, ...patch, monthValues: {} };
    });

    rowsRef.current = nextRows;
    setRows(nextRows);

    void fetch("/api/flow-rows", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, patch: patchForServer }),
    });
  };

  const deleteRow = (id: string) => {
    const nextRows = rowsRef.current.filter((row) => row.id !== id);
    rowsRef.current = nextRows;
    setRows(nextRows);

    void fetch(`/api/flow-rows?id=${id}`, {
      method: "DELETE",
    });
  };

  const updateCellValue = (rowId: string, month: string, value: number) => {
    let patchMonthValues: Record<string, number> | null = null;
    const nextRows = rowsRef.current.map((row) => {
      if (row.id !== rowId || !isMonthInRange(month, row.startMonth, row.endMonth)) {
        return row;
      }

      const isBaseValue = value === row.amount;
      const nextMonthValues = { ...row.monthValues };
      if (isBaseValue) {
        delete nextMonthValues[month];
      } else {
        nextMonthValues[month] = value;
      }

      patchMonthValues = nextMonthValues;
      return {
        ...row,
        monthValues: nextMonthValues,
      };
    });

    rowsRef.current = nextRows;
    setRows(nextRows);

    if (!patchMonthValues) return;

    void fetch("/api/flow-rows", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: rowId, patch: { monthValues: patchMonthValues } }),
    });
  };

  return (
    <main className="flex w-full max-w-none flex-1 flex-col gap-4 px-2 py-3 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cashflow Spreadsheet</h1>
          <p className="text-xs text-muted-foreground">Układ arkusza: każda komórka miesiąca jest edytowalna.</p>
          {isLoading && <p className="text-xs text-muted-foreground">Ładowanie danych z bazy...</p>}
        </div>
        <UserButton />
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 rounded-sm border bg-white px-2 py-1 text-xs">
            CIT %
            <input
              type="number"
              min="0"
              step="0.1"
              value={citRate}
              onChange={(event) => setCitRate(Number(event.target.value) || 0)}
              className="h-6 w-14 border-l pl-1 outline-none"
            />
          </label>
          <label className="flex items-center gap-1 rounded-sm border bg-white px-2 py-1 text-xs">
            VAT %
            <input
              type="number"
              min="0"
              step="0.1"
              value={vatRate}
              onChange={(event) => setVatRate(Number(event.target.value) || 0)}
              className="h-6 w-14 border-l pl-1 outline-none"
            />
          </label>
          <Button variant="ghost" className="h-8 rounded-sm border bg-white px-2" onClick={() => setYearOffset((prev) => prev - 1)}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Poprzedni rok
          </Button>
          <Button variant="ghost" className="h-8 rounded-sm border bg-white px-2" onClick={() => setYearOffset((prev) => prev + 1)}>
            Następny rok
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
          <Button variant="ghost" className="h-8 rounded-sm border bg-white px-2" onClick={() => setYearOffset(0)}>
            Ten rok
          </Button>
        </div>
      </div>

      <div className="overflow-x-hidden rounded-sm border border-slate-300 bg-white">
        <Table className="w-full table-fixed border-collapse text-xs tabular-nums">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="sticky top-0 z-20 w-[170px] border border-slate-300 bg-slate-100 text-xs font-semibold text-slate-700">
                  Nazwa
                </TableHead>
                <TableHead className="sticky top-0 z-20 w-[100px] border border-slate-300 bg-slate-100 text-right text-xs font-semibold text-slate-700">
                  Kwota
                </TableHead>
                <TableHead className="sticky top-0 z-20 w-[130px] border border-slate-300 bg-slate-100 text-xs font-semibold text-slate-700">
                  Od
                </TableHead>
                <TableHead className="sticky top-0 z-20 w-[130px] border border-slate-300 bg-slate-100 text-xs font-semibold text-slate-700">
                  Do
                </TableHead>
                {months.map((month) => (
                  <TableHead
                    key={month.key}
                    className="sticky top-0 z-20 w-[84px] border border-slate-300 bg-slate-100 text-right text-xs font-semibold text-slate-700"
                  >
                    {month.label}
                  </TableHead>
                ))}
                <TableHead className="sticky top-0 z-20 w-[110px] border border-slate-300 bg-slate-100 text-right text-xs font-semibold text-slate-700">
                  Suma
                </TableHead>
                <TableHead className="sticky top-0 z-20 w-[56px] border border-slate-300 bg-slate-100 text-right text-xs font-semibold text-slate-700">
                  Akcja
                </TableHead>
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
                  onUpdateCell={updateCellValue}
                  onDelete={deleteRow}
                />
              ))}
              <SectionAddRow label="+ Dodaj przychód" onClick={() => addRow("income")} colSpan={months.length + 6} />

              <SectionHeader title="WYDATKI" />
              {expenseRows.map((row) => (
                <SpreadsheetRow
                  key={row.id}
                  row={row}
                  months={months}
                  onUpdate={updateRow}
                  onUpdateCell={updateCellValue}
                  onDelete={deleteRow}
                />
              ))}
              <SectionAddRow label="+ Dodaj wydatek" onClick={() => addRow("expense")} colSpan={months.length + 6} />
            </TableBody>
            <TableFooter className="bg-white">
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="border border-slate-300 bg-slate-50 text-xs font-semibold">
                  Miesięczne saldo
                </TableCell>
                {monthlyTotals.map((total) => (
                  <TableCell
                    key={total.key}
                    className={`border border-slate-300 text-right text-xs font-semibold ${total.balance >= 0 ? "text-emerald-700" : "text-rose-700"}`}
                  >
                    {money.format(total.balance)}
                  </TableCell>
                ))}
                <TableCell className="border border-slate-300 bg-slate-50 text-right text-xs font-semibold">
                  {money.format(monthlyTotals.reduce((sum, total) => sum + total.balance, 0))}
                </TableCell>
                <TableCell className="border border-slate-300 bg-slate-50" />
              </TableRow>
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="border border-slate-300 bg-slate-50 text-xs font-semibold">
                  Stan skumulowany
                </TableCell>
                {cumulativeBalances.map((entry) => (
                  <TableCell
                    key={entry.key}
                    className={`border border-slate-300 text-right text-xs font-semibold ${entry.value >= 0 ? "text-emerald-700" : "text-rose-700"}`}
                  >
                    {money.format(entry.value)}
                  </TableCell>
                ))}
                <TableCell className="border border-slate-300 bg-slate-50 text-right text-xs font-semibold">
                  {money.format(cumulativeBalances.at(-1)?.value ?? 0)}
                </TableCell>
                <TableCell className="border border-slate-300 bg-slate-50" />
              </TableRow>
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="border border-slate-300 bg-slate-50 text-xs font-semibold">
                  Podatek dochodowy spółki (CIT)
                </TableCell>
                {taxTotals.map((entry) => (
                  <TableCell key={entry.key} className="border border-slate-300 text-right text-xs font-semibold text-amber-700">
                    {money.format(entry.cit)}
                  </TableCell>
                ))}
                <TableCell className="border border-slate-300 bg-slate-50 text-right text-xs font-semibold text-amber-700">
                  {money.format(taxTotals.reduce((sum, entry) => sum + entry.cit, 0))}
                </TableCell>
                <TableCell className="border border-slate-300 bg-slate-50" />
              </TableRow>
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="border border-slate-300 bg-slate-50 text-xs font-semibold">
                  VAT płatny kwartalnie
                </TableCell>
                {taxTotals.map((entry) => (
                  <TableCell
                    key={entry.key}
                    className={`border border-slate-300 text-right text-xs font-semibold ${entry.vatPayment >= 0 ? "text-amber-700" : "text-emerald-700"}`}
                  >
                    {money.format(entry.vatPayment)}
                  </TableCell>
                ))}
                <TableCell
                  className={`border border-slate-300 bg-slate-50 text-right text-xs font-semibold ${
                    taxTotals.reduce((sum, entry) => sum + entry.vatPayment, 0) >= 0 ? "text-amber-700" : "text-emerald-700"
                  }`}
                >
                  {money.format(taxTotals.reduce((sum, entry) => sum + entry.vatPayment, 0))}
                </TableCell>
                <TableCell className="border border-slate-300 bg-slate-50" />
              </TableRow>
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="border border-slate-300 bg-slate-100 text-xs font-semibold">
                  Stan skumulowany po podatkach
                </TableCell>
                {cumulativeNetAfterTax.map((entry) => (
                  <TableCell
                    key={entry.key}
                    className={`border border-slate-300 text-right text-xs font-semibold ${entry.value >= 0 ? "text-emerald-700" : "text-rose-700"}`}
                  >
                    {money.format(entry.value)}
                  </TableCell>
                ))}
                <TableCell className="border border-slate-300 bg-slate-100 text-right text-xs font-semibold">
                  {money.format(cumulativeNetAfterTax.at(-1)?.value ?? 0)}
                </TableCell>
                <TableCell className="border border-slate-300 bg-slate-100" />
              </TableRow>
            </TableFooter>
          </Table>
      </div>
    </main>
  );
}

type SpreadsheetRowProps = {
  row: FlowRow;
  months: MonthColumn[];
  onUpdate: (id: string, patch: Partial<FlowRow>) => void;
  onUpdateCell: (rowId: string, month: string, value: number) => void;
  onDelete: (id: string) => void;
};

function SpreadsheetRow({ row, months, onUpdate, onUpdateCell, onDelete }: SpreadsheetRowProps) {
  const rowTotal = months.reduce((sum, month) => sum + getCellValue(row, month.key), 0);
  const toneClass = row.type === "income" ? "text-emerald-700" : "text-rose-700";

  return (
    <TableRow className="hover:bg-transparent">
      <TableCell className="border border-slate-300 p-0">
        <Input
          value={row.name}
          onChange={(event) => onUpdate(row.id, { name: event.target.value })}
          className="h-8 rounded-none border-0 bg-transparent text-xs shadow-none focus-visible:ring-1"
        />
      </TableCell>
      <TableCell className="border border-slate-300 p-0 text-right">
        <Input
          type="number"
          step="0.01"
          min="0"
          value={row.amount}
          onChange={(event) => onUpdate(row.id, { amount: Number(event.target.value) || 0 })}
          className="h-8 rounded-none border-0 bg-transparent pr-1 text-right text-xs shadow-none focus-visible:ring-1 [appearance:textfield]"
        />
      </TableCell>
      <TableCell className="border border-slate-300 p-0">
        <Input
          type="date"
          value={`${row.startMonth}-01`}
          onChange={(event) => onUpdate(row.id, { startMonth: event.target.value.slice(0, 7) })}
          className="h-8 rounded-none border-0 bg-transparent pr-1 text-xs shadow-none focus-visible:ring-1"
        />
      </TableCell>
      <TableCell className="border border-slate-300 p-0">
        <Input
          type="date"
          value={row.endMonth ? `${row.endMonth}-01` : ""}
          onChange={(event) => onUpdate(row.id, { endMonth: event.target.value ? event.target.value.slice(0, 7) : null })}
          className="h-8 rounded-none border-0 bg-transparent pr-1 text-xs shadow-none focus-visible:ring-1"
        />
      </TableCell>
      {months.map((month) => {
        const value = getCellValue(row, month.key);
        const hasStarted = isMonthInRange(month.key, row.startMonth, row.endMonth);
        return (
          <TableCell key={month.key} className="border border-slate-300 p-0 text-right">
            <Input
              type="number"
              disabled={!hasStarted}
              min="0"
              step="0.01"
              value={hasStarted ? value : ""}
              placeholder={hasStarted ? "" : "—"}
              onChange={(event) => onUpdateCell(row.id, month.key, Number(event.target.value) || 0)}
              className={`h-8 rounded-none border-0 bg-transparent px-1 text-right text-xs shadow-none focus-visible:ring-1 [appearance:textfield] ${
                !hasStarted ? "cursor-not-allowed text-slate-300" : "text-slate-800"
              }`}
            />
          </TableCell>
        );
      })}
      <TableCell className={`border border-slate-300 text-right text-xs font-semibold ${toneClass}`}>
        {money.format(rowTotal)}
      </TableCell>
      <TableCell className="border border-slate-300 p-0 text-right">
        <Button
          variant="ghost"
          className="h-8 w-full rounded-none px-0 text-muted-foreground hover:bg-rose-50 hover:text-rose-700"
          onClick={() => onDelete(row.id)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={999} className="border border-slate-300 bg-slate-200 py-1 text-xs font-semibold tracking-[0.08em] text-slate-700">
        {title}
      </TableCell>
    </TableRow>
  );
}

function SectionAddRow({ label, onClick, colSpan }: { label: string; onClick: () => void; colSpan: number }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="border border-slate-300 p-0">
        <Button variant="ghost" className="h-8 w-full justify-start rounded-none bg-slate-50 px-2 text-xs text-primary hover:bg-slate-100" onClick={onClick}>
          {label}
        </Button>
      </TableCell>
    </TableRow>
  );
}

function getCellValue(row: FlowRow, month: string) {
  const hasStarted = isMonthInRange(month, row.startMonth, row.endMonth);
  if (!hasStarted) return 0;
  const override = row.monthValues[month];
  return override === undefined ? row.amount : override;
}

function monthKeyFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getYearMonthsWindow(yearOffset: number): MonthColumn[] {
  const year = new Date().getFullYear() + yearOffset;
  return Array.from({ length: 12 }, (_, index) => {
    const monthDate = new Date(year, index, 1);
    const key = monthKeyFromDate(monthDate);
    return { key, label: formatMonthLabel(key) };
  });
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  return `${month}/${year}`;
}

function isQuarterSettlementMonth(monthKey: string) {
  const monthNumber = Number(monthKey.split("-")[1]);
  return monthNumber % 3 === 0;
}

function hasStartedInYear(monthKey: string, startMonthKey: string) {
  const monthNumber = Number(monthKey.split("-")[1]);
  const startMonthNumber = Number(startMonthKey.split("-")[1]);
  return monthNumber >= startMonthNumber;
}

function isMonthInRange(monthKey: string, startMonthKey: string, endMonthKey: string | null) {
  const starts = hasStartedInYear(monthKey, startMonthKey);
  if (!starts) return false;
  if (!endMonthKey) return true;

  const monthNumber = Number(monthKey.split("-")[1]);
  const endMonthNumber = Number(endMonthKey.split("-")[1]);
  return monthNumber <= endMonthNumber;
}
