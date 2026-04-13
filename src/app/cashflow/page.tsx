"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Trash2 } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { NumericInput } from "@/components/numeric-input";
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
  isImported: boolean;
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

export default function CashflowPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const [rows, setRows] = useState<FlowRow[]>([]);
  const rowsRef = useRef<FlowRow[]>([]);
  const isSyncingRef = useRef(false);
  const [yearOffset, setYearOffset] = useState(0);
  const [citRate, setCitRate] = useState(19);
  const [vatRate, setVatRate] = useState(23);
  const [isLoading, setIsLoading] = useState(true);
  const [showFitsseyIncomeRows, setShowFitsseyIncomeRows] = useState(true);

  useEffect(() => {
    const saved = window.localStorage.getItem("cashflow_show_fitssey_income_rows");
    if (saved === "0") setShowFitsseyIncomeRows(false);
    if (saved === "1") setShowFitsseyIncomeRows(true);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("cashflow_show_fitssey_income_rows", showFitsseyIncomeRows ? "1" : "0");
  }, [showFitsseyIncomeRows]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setRows([]);
      rowsRef.current = [];
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    const loadRows = async (withLoading: boolean) => {
      if (withLoading) setIsLoading(true);
      try {
        const response = await fetch("/api/flow-rows");
        if (!response.ok) return;
        const data = (await response.json()) as FlowRow[];
        if (!isMounted) return;
        setRows(data);
        rowsRef.current = data;
      } finally {
        if (withLoading && isMounted) setIsLoading(false);
      }
    };

    const loadTaxSettings = async () => {
      try {
        const response = await fetch("/api/settings/fitssey");
        if (!response.ok) return;
        const payload = (await response.json()) as { citRate?: number; vatRate?: number };
        if (typeof payload.citRate === "number") setCitRate(payload.citRate);
        if (typeof payload.vatRate === "number") setVatRate(payload.vatRate);
      } catch {
        // keep defaults
      }
    };

    const backgroundSync = async () => {
      if (isSyncingRef.current) return;
      isSyncingRef.current = true;
      try {
        await fetch("/api/fitssey/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ auto: true }),
        });
        await loadRows(false);
      } catch {
        // Silent background sync.
      } finally {
        isSyncingRef.current = false;
      }
    };

    const handleActivation = () => {
      void backgroundSync();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void backgroundSync();
      }
    };

    void loadTaxSettings();
    void loadRows(true).then(() => {
      void backgroundSync();
    });
    window.addEventListener("focus", handleActivation);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMounted = false;
      window.removeEventListener("focus", handleActivation);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isLoaded, isSignedIn]);

  const months = useMemo(() => getYearMonthsWindow(yearOffset), [yearOffset]);
  const incomeRows = useMemo(() => {
    const manual = rows.filter((row) => row.type === "income" && !row.isImported);
    const imported = rows
      .filter((row) => row.type === "income" && row.isImported)
      .sort((a, b) => a.name.localeCompare(b.name, "pl", { sensitivity: "base" }));
    return [...manual, ...imported];
  }, [rows]);
  const expenseRows = useMemo(() => rows.filter((row) => row.type === "expense"), [rows]);
  const importedIncomeRows = useMemo(() => incomeRows.filter((row) => row.isImported), [incomeRows]);
  const manualIncomeRows = useMemo(() => incomeRows.filter((row) => !row.isImported), [incomeRows]);
  const visibleImportedIncomeRows = useMemo(
    () => importedIncomeRows.filter((row) => months.some((month) => getCellValue(row, month.key) !== 0)),
    [importedIncomeRows, months],
  );

  const currentMonthKey = monthKeyFromDate(new Date());
  const displayStartMonth = months[0]?.key ?? currentMonthKey;
  const displayEndMonth = months[months.length - 1]?.key ?? currentMonthKey;

  const timelineMonths = useMemo(() => {
    const candidateMonths = rows.flatMap((row) => [row.startMonth, row.endMonth, ...Object.keys(row.monthValues)]).filter(Boolean) as string[];
    const earliestMonth = candidateMonths.reduce((min, month) => (monthKeyToIndex(month) < monthKeyToIndex(min) ? month : min), displayStartMonth);
    return buildMonthRange(earliestMonth, displayEndMonth);
  }, [rows, displayStartMonth, displayEndMonth]);

  const timelineComputed = useMemo(() => {
    const actualByMonth = timelineMonths.map((key) => {
      const income = incomeRows.reduce((sum, row) => sum + getCellValue(row, key), 0);
      const expenses = expenseRows.reduce((sum, row) => sum + getCellValue(row, key), 0);
      return { key, income, expenses };
    });

    const nonZeroHistoryIncome = actualByMonth
      .filter((month) => month.key <= currentMonthKey)
      .map((month) => month.income)
      .filter((value) => value > 0);
    const forecastBaseline = nonZeroHistoryIncome.length > 0 ? Math.max(...nonZeroHistoryIncome) : 0;

    const computed = [];
    let cumulative = 0;
    let cumulativeNet = 0;
    let previousSettlementIndex = -1;
    const vatAccrual = actualByMonth.map((month) => {
      const effectiveIncome = month.key > currentMonthKey ? Math.round(forecastBaseline) : month.income;
      return effectiveIncome * (vatRate / 100) - month.expenses * (vatRate / 100);
    });

    for (let index = 0; index < actualByMonth.length; index += 1) {
      const month = actualByMonth[index];
      const forecastIncome = month.key > currentMonthKey ? Math.round(forecastBaseline) : month.income;
      const effectiveIncome = forecastIncome;
      const balance = effectiveIncome - month.expenses;
      const cit = Math.max(balance, 0) * (citRate / 100);
      const isSettlementMonth = isQuarterSettlementMonth(month.key);
      const vatPayment = isSettlementMonth ? vatAccrual.slice(previousSettlementIndex + 1, index + 1).reduce((sum, amount) => sum + amount, 0) : 0;
      if (isSettlementMonth) previousSettlementIndex = index;

      cumulative += balance;
      cumulativeNet += balance - cit - vatPayment;

      computed.push({
        key: month.key,
        income: effectiveIncome,
        forecastIncome,
        expenses: month.expenses,
        balance,
        cit,
        vatPayment,
        cumulative,
        cumulativeNet,
      });
    }

    return new Map(computed.map((month) => [month.key, month]));
  }, [timelineMonths, incomeRows, expenseRows, currentMonthKey, citRate, vatRate]);

  const effectiveMonthlyTotals = useMemo(
    () =>
      months.map((month) => {
        const computed = timelineComputed.get(month.key);
        return {
          key: month.key,
          income: computed?.income ?? 0,
          expenses: computed?.expenses ?? 0,
          balance: computed?.balance ?? 0,
        };
      }),
    [months, timelineComputed],
  );

  const forecastIncomeTotals = useMemo(
    () => months.map((month) => timelineComputed.get(month.key)?.forecastIncome ?? 0),
    [months, timelineComputed],
  );

  const cumulativeBalances = useMemo(
    () => months.map((month) => ({ key: month.key, value: timelineComputed.get(month.key)?.cumulative ?? 0 })),
    [months, timelineComputed],
  );

  const taxTotals = useMemo(
    () =>
      months.map((month) => {
        const computed = timelineComputed.get(month.key);
        return { key: month.key, cit: computed?.cit ?? 0, vatPayment: computed?.vatPayment ?? 0 };
      }),
    [months, timelineComputed],
  );

  const cumulativeNetAfterTax = useMemo(
    () => months.map((month) => ({ key: month.key, value: timelineComputed.get(month.key)?.cumulativeNet ?? 0 })),
    [months, timelineComputed],
  );

  const addRow = (type: FlowType) => {
    const todayMonth = monthKeyFromDate(new Date());
    const draft: FlowRow = {
      id: crypto.randomUUID(),
      type,
      name: type === "income" ? "Nowy przychód" : "Nowy wydatek",
      isImported: false,
      amount: 0,
      startMonth: todayMonth,
      endMonth: null,
      monthValues: {},
    };

    const nextRows = [...rowsRef.current, draft];
    rowsRef.current = nextRows;
    setRows(nextRows);

    void fetch("/api/flow-rows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    }).then((response) => {
      if (!response.ok) return;
      void response.json().then((saved: FlowRow) => {
        const replaced = rowsRef.current.map((row) => (row.id === draft.id ? saved : row));
        rowsRef.current = replaced;
        setRows(replaced);
      });
    });
  };

  const updateRow = (id: string, patch: Partial<FlowRow>) => {
    let patchForServer: Partial<FlowRow> = patch;
    const nextRows = rowsRef.current.map((row) => {
      if (row.id !== id) return row;
      if (row.isImported && (patch.amount !== undefined || patch.startMonth !== undefined || patch.endMonth !== undefined)) {
        return row;
      }
      const shouldOverrideMonthlyEdits = patch.amount !== undefined || patch.startMonth !== undefined || patch.endMonth !== undefined;
      if (!shouldOverrideMonthlyEdits) return { ...row, ...patch };
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
    void fetch(`/api/flow-rows?id=${id}`, { method: "DELETE" });
  };

  const updateCellValue = (rowId: string, month: string, value: number) => {
    let patchMonthValues: Record<string, number> | null = null;
    const nextRows = rowsRef.current.map((row) => {
      if (row.id !== rowId || !isMonthInRange(month, row.startMonth, row.endMonth)) return row;
      if (row.isImported) return row;
      const isBaseValue = value === row.amount;
      const nextMonthValues = { ...row.monthValues };
      if (isBaseValue) delete nextMonthValues[month];
      else nextMonthValues[month] = value;
      patchMonthValues = nextMonthValues;
      return { ...row, monthValues: nextMonthValues };
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
    <AppShell title="Cashflow" subtitle="Arkusz oparty wyłącznie na wartościach, które wpisujesz ręcznie.">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-slate-300 bg-white px-3 py-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-sm border bg-white px-2 py-1">CIT: {money.format(citRate)}%</span>
          <span className="rounded-sm border bg-white px-2 py-1">VAT: {money.format(vatRate)}%</span>
          {isLoading && <span className="text-muted-foreground">Ładowanie danych...</span>}
        </div>
        <div className="flex items-center gap-2">
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
              <TableHead className="sticky top-0 z-20 w-[170px] border border-slate-300 bg-slate-100">Nazwa</TableHead>
              <TableHead className="sticky top-0 z-20 w-[100px] border border-slate-300 bg-slate-100 text-right">Kwota</TableHead>
              <TableHead className="sticky top-0 z-20 w-[130px] border border-slate-300 bg-slate-100">Od</TableHead>
              <TableHead className="sticky top-0 z-20 w-[130px] border border-slate-300 bg-slate-100">Do</TableHead>
              {months.map((month) => (
                <TableHead key={month.key} className="sticky top-0 z-20 w-[84px] border border-slate-300 bg-slate-100 text-right">
                  {month.label}
                </TableHead>
              ))}
              <TableHead className="sticky top-0 z-20 w-[110px] border border-slate-300 bg-slate-100 text-right">Suma</TableHead>
              <TableHead className="sticky top-0 z-20 w-[56px] border border-slate-300 bg-slate-100 text-right">Akcja</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <SectionHeader title="PRZYCHODY" />
            {visibleImportedIncomeRows.length > 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={months.length + 6} className="border border-slate-300 p-0">
                  <Button
                    variant="ghost"
                    className="h-8 w-full justify-between rounded-none bg-slate-50 px-2 text-xs text-slate-700 hover:bg-slate-100"
                    onClick={() => setShowFitsseyIncomeRows((prev) => !prev)}
                  >
                    <span>Przychody z Fitssey ({visibleImportedIncomeRows.length})</span>
                    {showFitsseyIncomeRows ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </TableCell>
              </TableRow>
            )}
            {showFitsseyIncomeRows &&
              visibleImportedIncomeRows.map((row) => (
                <SpreadsheetRow key={row.id} row={row} months={months} onUpdate={updateRow} onUpdateCell={updateCellValue} onDelete={deleteRow} />
              ))}
            {manualIncomeRows.map((row) => (
              <SpreadsheetRow key={row.id} row={row} months={months} onUpdate={updateRow} onUpdateCell={updateCellValue} onDelete={deleteRow} />
            ))}
            <SectionAddRow label="+ Dodaj przychód" onClick={() => addRow("income")} colSpan={months.length + 6} />

            <SectionHeader title="WYDATKI" />
            {expenseRows.map((row) => (
              <SpreadsheetRow key={row.id} row={row} months={months} onUpdate={updateRow} onUpdateCell={updateCellValue} onDelete={deleteRow} />
            ))}
            <SectionAddRow label="+ Dodaj wydatek" onClick={() => addRow("expense")} colSpan={months.length + 6} />
          </TableBody>
          <TableFooter className="bg-white">
            <SummaryRow label="Miesięczne przychody" values={effectiveMonthlyTotals.map((v) => v.income)} textClass="text-emerald-700" />
            <SummaryRow label="Prognoza przychodów (auto)" values={forecastIncomeTotals} textClass="text-blue-700" />
            <SummaryRow label="Miesięczne wydatki" values={effectiveMonthlyTotals.map((v) => v.expenses)} textClass="text-rose-700" />
            <SummaryRow label="Miesięczne saldo" values={effectiveMonthlyTotals.map((v) => v.balance)} />
            <SummaryRow label="Stan skumulowany" values={cumulativeBalances.map((v) => v.value)} totalMode="last" />
            <SummaryRow label="Podatek dochodowy spółki (CIT)" values={taxTotals.map((v) => v.cit)} textClass="text-amber-700" />
            <SummaryRow
              label="VAT płatny kwartalnie"
              values={taxTotals.map((v) => v.vatPayment)}
              valueClassBySign
            />
            <SummaryRow label="Stan skumulowany po podatkach" values={cumulativeNetAfterTax.map((v) => v.value)} totalMode="last" />
          </TableFooter>
        </Table>
      </div>
    </AppShell>
  );
}

function SummaryRow({
  label,
  values,
  textClass,
  valueClassBySign,
  totalMode = "sum",
}: {
  label: string;
  values: number[];
  textClass?: string;
  valueClassBySign?: boolean;
  totalMode?: "sum" | "last";
}) {
  const total = totalMode === "last" ? (values.at(-1) ?? 0) : values.reduce((sum, value) => sum + value, 0);
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={4} className="border border-slate-300 bg-slate-50 text-xs font-semibold">
        {label}
      </TableCell>
      {values.map((value, index) => (
        <TableCell
          key={index}
          className={`border border-slate-300 text-right text-xs font-semibold ${
            valueClassBySign ? (value >= 0 ? "text-amber-700" : "text-emerald-700") : textClass ?? (value >= 0 ? "text-emerald-700" : "text-rose-700")
          }`}
        >
          {money.format(value)}
        </TableCell>
      ))}
      <TableCell className="border border-slate-300 bg-slate-50 text-right text-xs font-semibold">{money.format(total)}</TableCell>
      <TableCell className="border border-slate-300 bg-slate-50" />
    </TableRow>
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
  const readOnlyImported = row.isImported;

  return (
    <TableRow className="hover:bg-transparent">
      <TableCell className="border border-slate-300 p-0">
        {readOnlyImported ? (
          <div className="flex h-8 items-center px-2 text-xs">{row.name}</div>
        ) : (
          <Input
            value={row.name}
            onChange={(event) => onUpdate(row.id, { name: event.target.value })}
            className="h-8 rounded-none border-0 bg-transparent text-xs"
          />
        )}
      </TableCell>
      <TableCell className="border border-slate-300 p-0">
        {readOnlyImported ? (
          <div className="h-8" />
        ) : (
          <NumericInput value={row.amount} onValueChange={(value) => onUpdate(row.id, { amount: value })} className="h-8 rounded-none border-0 bg-transparent pr-1 text-right text-xs" />
        )}
      </TableCell>
      <TableCell className="border border-slate-300 p-0">
        {readOnlyImported ? (
          <div className="h-8" />
        ) : (
          <Input
            type="date"
            value={`${row.startMonth}-01`}
            onChange={(event) => onUpdate(row.id, { startMonth: event.target.value.slice(0, 7) })}
            className="h-8 rounded-none border-0 bg-transparent pr-1 text-xs"
          />
        )}
      </TableCell>
      <TableCell className="border border-slate-300 p-0">
        {readOnlyImported ? (
          <div className="h-8" />
        ) : (
          <Input
            type="date"
            value={row.endMonth ? `${row.endMonth}-01` : ""}
            onChange={(event) => onUpdate(row.id, { endMonth: event.target.value ? event.target.value.slice(0, 7) : null })}
            className={`h-8 rounded-none border-0 bg-transparent pr-1 text-xs ${row.endMonth ? "" : "date-empty"}`}
          />
        )}
      </TableCell>
      {months.map((month) => {
        const value = getCellValue(row, month.key);
        const enabled = isMonthInRange(month.key, row.startMonth, row.endMonth);
        return (
          <TableCell key={month.key} className="border border-slate-300 p-0">
            {enabled ? (
              readOnlyImported ? (
                <div className="flex h-8 items-center justify-end px-2 text-xs">{money.format(value)}</div>
              ) : (
                <NumericInput
                  value={value}
                  onValueChange={(nextValue) => onUpdateCell(row.id, month.key, nextValue)}
                  className="h-8 rounded-none border-0 bg-transparent px-1 text-right text-xs"
                />
              )
            ) : (
              <Input value="" placeholder="—" disabled className="h-8 rounded-none border-0 bg-transparent px-1 text-right text-xs text-slate-300" />
            )}
          </TableCell>
        );
      })}
      <TableCell className={`border border-slate-300 text-right text-xs font-semibold ${toneClass}`}>{money.format(rowTotal)}</TableCell>
      <TableCell className="border border-slate-300 p-0 text-right">
        {readOnlyImported ? (
          <div className="h-8" />
        ) : (
          <Button variant="ghost" className="h-8 w-full rounded-none px-0 text-muted-foreground hover:bg-rose-50 hover:text-rose-700" onClick={() => onDelete(row.id)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
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
  const enabled = isMonthInRange(month, row.startMonth, row.endMonth);
  if (!enabled) return 0;
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
    return { key, label: `${String(index + 1).padStart(2, "0")}/${year}` };
  });
}

function isQuarterSettlementMonth(monthKey: string) {
  const monthNumber = Number(monthKey.split("-")[1]);
  return monthNumber % 3 === 0;
}

function isMonthInRange(monthKey: string, startMonthKey: string, endMonthKey: string | null) {
  const monthIndex = monthKeyToIndex(monthKey);
  const startIndex = monthKeyToIndex(startMonthKey);
  const endIndex = endMonthKey ? monthKeyToIndex(endMonthKey) : Number.POSITIVE_INFINITY;
  return monthIndex >= startIndex && monthIndex <= endIndex;
}

function monthKeyToIndex(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return year * 12 + (month - 1);
}

function indexToMonthKey(index: number) {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function buildMonthRange(startMonthKey: string, endMonthKey: string) {
  const startIndex = monthKeyToIndex(startMonthKey);
  const endIndex = monthKeyToIndex(endMonthKey);
  if (endIndex < startIndex) return [endMonthKey];
  return Array.from({ length: endIndex - startIndex + 1 }, (_, offset) => indexToMonthKey(startIndex + offset));
}
