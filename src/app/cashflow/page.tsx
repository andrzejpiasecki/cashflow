"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Info } from "lucide-react";

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
  vatRate: number | null;
  amount: number;
  startMonth: string;
  endMonth: string | null;
  monthValues: Record<string, number>;
};

type MonthColumn = {
  key: string;
  label: string;
};

type FillModalState = {
  rowId: string;
  name: string;
  amount: number;
  startMonth: string;
  endMonth: string;
};

type InfoPopoverPosition = {
  top: number;
  left: number;
  placement: "above" | "below";
};

const money = new Intl.NumberFormat("pl-PL", {
  style: "decimal",
  maximumFractionDigits: 0,
});
const EXPENSE_VAT_RATE = 23;
const DEFAULT_FITSSEY_VAT_RATE = 8;

function vatFromGross(amount: number, rate: number) {
  if (!Number.isFinite(amount) || !Number.isFinite(rate) || amount === 0 || rate <= 0) return 0;
  return amount * (rate / (100 + rate));
}

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
  const [fillModal, setFillModal] = useState<FillModalState | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [showVatInfo, setShowVatInfo] = useState(false);
  const [vatInfoPosition, setVatInfoPosition] = useState<InfoPopoverPosition | null>(null);
  const [showCitInfo, setShowCitInfo] = useState(false);
  const [citInfoPosition, setCitInfoPosition] = useState<InfoPopoverPosition | null>(null);

  useEffect(() => {
    if (!fillModal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setConfirmDeleteOpen(false);
      setFillModal(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fillModal]);

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
    const candidateMonths = rows.flatMap((row) => Object.keys(row.monthValues));
    const earliestMonth = candidateMonths.reduce((min, month) => (monthKeyToIndex(month) < monthKeyToIndex(min) ? month : min), displayStartMonth);
    return buildMonthRange(earliestMonth, displayEndMonth);
  }, [rows, displayStartMonth, displayEndMonth]);

  const vatMonthBreakdown = useMemo(() => {
    const actualByMonth = timelineMonths.map((key) => {
      const income = incomeRows.reduce((sum, row) => sum + getCellValue(row, key), 0);
      const expenses = expenseRows.reduce((sum, row) => sum + getCellValue(row, key), 0);
      return { key, income, expenses };
    });

    const previousMonthsIncome = actualByMonth
      .filter((month) => month.key < currentMonthKey)
      .map((month) => month.income)
      .slice(-3);
    const forecastBaseline = previousMonthsIncome.length > 0
      ? Math.round(previousMonthsIncome.reduce((sum, value) => sum + value, 0) / previousMonthsIncome.length)
      : 0;

    return new Map(
      actualByMonth.map((month) => {
        const manualIncomeGross = incomeRows
          .filter((row) => !row.isImported)
          .reduce((sum, row) => sum + getCellValue(row, month.key), 0);
        const importedIncomeGrossActual = incomeRows
          .filter((row) => row.isImported)
          .reduce((sum, row) => sum + getCellValue(row, month.key), 0);
        const importedIncomeGrossEffective = month.key > currentMonthKey ? Math.round(forecastBaseline) : importedIncomeGrossActual;
        const importedOutputVat = incomeRows
          .filter((row) => row.isImported)
          .reduce((sum, row) => {
            const rowValue = month.key > currentMonthKey
              ? (importedIncomeGrossActual > 0 ? (getCellValue(row, month.key) / importedIncomeGrossActual) * importedIncomeGrossEffective : 0)
              : getCellValue(row, month.key);
            const rowVatRate = row.vatRate ?? DEFAULT_FITSSEY_VAT_RATE;
            return sum + vatFromGross(rowValue, rowVatRate);
          }, 0);
        const manualOutputVat = vatFromGross(manualIncomeGross, vatRate);
        const inputVat = vatFromGross(month.expenses, EXPENSE_VAT_RATE);
        return [
          month.key,
          {
            key: month.key,
            importedIncomeGross: importedIncomeGrossEffective,
            manualIncomeGross,
            expensesGross: month.expenses,
            importedOutputVat,
            manualOutputVat,
            inputVat,
            netVat: importedOutputVat + manualOutputVat - inputVat,
          },
        ];
      }),
    );
  }, [timelineMonths, incomeRows, expenseRows, currentMonthKey, vatRate]);

  const timelineComputed = useMemo(() => {
    const actualByMonth = timelineMonths.map((key) => {
      const income = incomeRows.reduce((sum, row) => sum + getCellValue(row, key), 0);
      const expenses = expenseRows.reduce((sum, row) => sum + getCellValue(row, key), 0);
      return { key, income, expenses };
    });

    const previousMonthsIncome = actualByMonth
      .filter((month) => month.key < currentMonthKey)
      .map((month) => month.income)
      .slice(-3);
    const forecastBaseline = previousMonthsIncome.length > 0
      ? Math.round(previousMonthsIncome.reduce((sum, value) => sum + value, 0) / previousMonthsIncome.length)
      : 0;

    const computed = [];
    let cumulative = 0;
    let cumulativeNet = 0;
    let previousSettlementIndex = -1;
    const yearProfitYtd = new Map<number, number>();
    const yearCitPaidYtd = new Map<number, number>();
    const vatAccrual = actualByMonth.map((month) => vatMonthBreakdown.get(month.key)?.netVat ?? 0);

    for (let index = 0; index < actualByMonth.length; index += 1) {
      const month = actualByMonth[index];
      const forecastIncome = month.key > currentMonthKey ? Math.round(forecastBaseline) : month.income;
      const effectiveIncome = forecastIncome;
      const balance = effectiveIncome - month.expenses;
      const year = Number(month.key.slice(0, 4));
      const prevProfitYtd = yearProfitYtd.get(year) ?? 0;
      const nextProfitYtd = prevProfitYtd + balance;
      yearProfitYtd.set(year, nextProfitYtd);
      const citBaseYtd = Math.max(nextProfitYtd, 0);
      const citDueYtd = citBaseYtd * (citRate / 100);
      const paidYtd = yearCitPaidYtd.get(year) ?? 0;
      const cit = Math.max(citDueYtd - paidYtd, 0);
      yearCitPaidYtd.set(year, paidYtd + cit);
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
        citBaseYtd,
        citDueYtd,
        vatPayment,
        cumulative,
        cumulativeNet,
      });
    }

    return new Map(computed.map((month) => [month.key, month]));
  }, [timelineMonths, incomeRows, expenseRows, currentMonthKey, citRate, vatMonthBreakdown]);

  const taxInfoMonthKey = useMemo(() => {
    if (vatMonthBreakdown.has(currentMonthKey) || timelineComputed.has(currentMonthKey)) return currentMonthKey;
    const latestKey = [...timelineComputed.keys()].sort().at(-1);
    return latestKey ?? currentMonthKey;
  }, [vatMonthBreakdown, timelineComputed, currentMonthKey]);

  const currentMonthVatInfo = useMemo(() => {
    const fallback = {
      key: taxInfoMonthKey,
      importedIncomeGross: 0,
      manualIncomeGross: 0,
      expensesGross: 0,
      importedOutputVat: 0,
      manualOutputVat: 0,
      inputVat: 0,
      netVat: 0,
      vatPayment: 0,
    };
    const monthData = vatMonthBreakdown.get(taxInfoMonthKey);
    if (!monthData) return fallback;
    return {
      ...monthData,
      key: taxInfoMonthKey,
      vatPayment: timelineComputed.get(taxInfoMonthKey)?.vatPayment ?? 0,
    };
  }, [vatMonthBreakdown, timelineComputed, taxInfoMonthKey]);

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

  const currentMonthCitInfo = useMemo(() => {
    const monthData = timelineComputed.get(taxInfoMonthKey);
    return {
      key: taxInfoMonthKey,
      income: monthData?.income ?? 0,
      expenses: monthData?.expenses ?? 0,
      balance: monthData?.balance ?? 0,
      taxableBase: monthData?.citBaseYtd ?? 0,
      citDueYtd: monthData?.citDueYtd ?? 0,
      cit: monthData?.cit ?? 0,
    };
  }, [timelineComputed, taxInfoMonthKey]);

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
      vatRate: null,
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

  const deleteRow = (id: string) => {
    const nextRows = rowsRef.current.filter((row) => row.id !== id);
    rowsRef.current = nextRows;
    setRows(nextRows);
    void fetch(`/api/flow-rows?id=${id}`, { method: "DELETE" });
  };

  const updateCellValue = (rowId: string, month: string, value: number) => {
    let patchMonthValues: Record<string, number> | null = null;
    const nextRows = rowsRef.current.map((row) => {
      if (row.id !== rowId) return row;
      if (row.isImported) return row;
      const nextMonthValues = { ...row.monthValues };
      nextMonthValues[month] = value;
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

  const openFillModal = (row: FlowRow) => {
    if (row.isImported) return;
    const monthKeys = Object.keys(row.monthValues).sort();
    const firstValueMonth = monthKeys.find((key) => (row.monthValues[key] ?? 0) !== 0) ?? months[0]?.key ?? monthKeyFromDate(new Date());
    const lastValueMonth = [...monthKeys].reverse().find((key) => (row.monthValues[key] ?? 0) !== 0) ?? firstValueMonth;
    const firstValue = row.monthValues[firstValueMonth] ?? 0;

    setFillModal({
      rowId: row.id,
      name: row.name,
      amount: firstValue,
      startMonth: row.startMonth || firstValueMonth,
      endMonth: row.endMonth || lastValueMonth,
    });
    setConfirmDeleteOpen(false);
  };

  const saveFillModal = () => {
    if (!fillModal) return;
    const { rowId, name, amount, startMonth, endMonth } = fillModal;
    const from = startMonth || endMonth;
    const to = endMonth || startMonth;
    if (!from || !to) {
      setFillModal(null);
      return;
    }

    const startIndex = monthKeyToIndex(from);
    const endIndex = monthKeyToIndex(to);
    const rangeStart = Math.min(startIndex, endIndex);
    const rangeEnd = Math.max(startIndex, endIndex);

    let patchPayload: Partial<FlowRow> | null = null;
    const nextRows = rowsRef.current.map((row) => {
      if (row.id !== rowId) return row;
      if (row.isImported) return row;
      const nextMonthValues = { ...row.monthValues };
      for (let index = rangeStart; index <= rangeEnd; index += 1) {
        nextMonthValues[indexToMonthKey(index)] = amount;
      }
      patchPayload = {
        name,
        amount,
        startMonth: indexToMonthKey(rangeStart),
        endMonth: indexToMonthKey(rangeEnd),
        monthValues: nextMonthValues,
      };
      return { ...row, ...patchPayload };
    });

    rowsRef.current = nextRows;
    setRows(nextRows);
    setFillModal(null);
    setConfirmDeleteOpen(false);
    if (!patchPayload) return;

    void fetch("/api/flow-rows", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: rowId, patch: patchPayload }),
    });
  };

  return (
    <AppShell title="Cashflow" subtitle="Arkusz oparty wyłącznie na wartościach, które wpisujesz ręcznie.">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-slate-300 bg-white px-3 py-2">
          <div className="flex items-center gap-2 text-xs">
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

        <div className="space-y-2 lg:hidden">
          <div className="rounded-sm border border-slate-300 bg-white p-3">
            <p className="text-xs font-semibold text-slate-700">
              Widok mobilny: podsumowanie (edycja dostępna na desktopie)
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-sm border border-slate-200 bg-slate-50 px-2 py-1">
                <p className="text-slate-500">Przychody (rok)</p>
                <p className="font-semibold text-emerald-700">{money.format(effectiveMonthlyTotals.reduce((sum, v) => sum + v.income, 0))}</p>
              </div>
              <div className="rounded-sm border border-slate-200 bg-slate-50 px-2 py-1">
                <p className="text-slate-500">Wydatki (rok)</p>
                <p className="font-semibold text-rose-700">{money.format(effectiveMonthlyTotals.reduce((sum, v) => sum + v.expenses, 0))}</p>
              </div>
              <div className="rounded-sm border border-slate-200 bg-slate-50 px-2 py-1">
                <p className="text-slate-500">Saldo (rok)</p>
                <p className="font-semibold">{money.format(effectiveMonthlyTotals.reduce((sum, v) => sum + v.balance, 0))}</p>
              </div>
              <div className="rounded-sm border border-slate-200 bg-slate-50 px-2 py-1">
                <p className="text-slate-500">Stan po podatkach</p>
                <p className="font-semibold">{money.format(cumulativeNetAfterTax.at(-1)?.value ?? 0)}</p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {months.map((month, index) => {
              const monthly = effectiveMonthlyTotals[index];
              const cumulative = cumulativeBalances[index]?.value ?? 0;
              const cumulativeNet = cumulativeNetAfterTax[index]?.value ?? 0;
              const taxes = taxTotals[index];
              const forecast = forecastIncomeTotals[index] ?? 0;
              return (
                <div key={month.key} className="rounded-sm border border-slate-300 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold">{month.label}</h3>
                    <span className="text-xs text-slate-500">Saldo: {money.format(monthly?.balance ?? 0)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <span className="text-slate-500">Przychody</span>
                    <span className="text-right text-emerald-700">{money.format(monthly?.income ?? 0)}</span>
                    <span className="text-slate-500">Prognoza auto</span>
                    <span className="text-right text-blue-700">{money.format(forecast)}</span>
                    <span className="text-slate-500">Wydatki</span>
                    <span className="text-right text-rose-700">{money.format(monthly?.expenses ?? 0)}</span>
                    <span className="inline-flex items-center gap-1 text-slate-500">
                      CIT
                      <button
                        type="button"
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600"
                        onClick={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect();
                          const panelWidth = Math.min(340, window.innerWidth - 24);
                          const estimatedPanelHeight = 220;
                          const desiredLeft = rect.left - 18;
                          const maxLeft = Math.max(12, window.innerWidth - panelWidth - 12);
                          const canOpenAbove = rect.top - 12 >= estimatedPanelHeight;
                          const placement: "above" | "below" = canOpenAbove ? "above" : "below";
                          const top = placement === "above" ? rect.top - 6 : rect.bottom + 8;
                          setCitInfoPosition({
                            top,
                            left: Math.max(12, Math.min(desiredLeft, maxLeft)),
                            placement,
                          });
                          setShowVatInfo(false);
                          setShowCitInfo((prev) => !prev);
                        }}
                        aria-label="Sposób liczenia CIT"
                      >
                        <Info className="h-3 w-3" />
                      </button>
                    </span>
                    <span className="text-right text-amber-700">{money.format(taxes?.cit ?? 0)}</span>
                    <span className="inline-flex items-center gap-1 text-slate-500">
                      VAT (kwartał)
                      <button
                        type="button"
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600"
                        onClick={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect();
                          const panelWidth = Math.min(340, window.innerWidth - 24);
                          const estimatedPanelHeight = 260;
                          const desiredLeft = rect.left - 18;
                          const maxLeft = Math.max(12, window.innerWidth - panelWidth - 12);
                          const canOpenAbove = rect.top - 12 >= estimatedPanelHeight;
                          const placement: "above" | "below" = canOpenAbove ? "above" : "below";
                          const top = placement === "above" ? rect.top - 6 : rect.bottom + 8;
                          setVatInfoPosition({
                            top,
                            left: Math.max(12, Math.min(desiredLeft, maxLeft)),
                            placement,
                          });
                          setShowCitInfo(false);
                          setShowVatInfo((prev) => !prev);
                        }}
                        aria-label="Sposób liczenia VAT"
                      >
                        <Info className="h-3 w-3" />
                      </button>
                    </span>
                    <span className="text-right">{money.format(taxes?.vatPayment ?? 0)}</span>
                    <span className="text-slate-500">Stan skumulowany</span>
                    <span className="text-right">{money.format(cumulative)}</span>
                    <span className="text-slate-500">Stan po podatkach</span>
                    <span className="text-right">{money.format(cumulativeNet)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="hidden overflow-x-hidden rounded-sm border border-slate-300 bg-white lg:block">
          <Table className="w-full table-fixed border-collapse text-xs tabular-nums">
            <CashflowColGroup months={months} />
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="border border-slate-300 bg-slate-100">Nazwa</TableHead>
                {months.map((month) => (
                  <TableHead
                    key={month.key}
                    className={`border px-1 text-right text-[10px] sm:text-xs ${
                      month.key === currentMonthKey ? "border-blue-300 bg-blue-50 text-blue-800" : "border-slate-300 bg-slate-100"
                    }`}
                  >
                    {month.label}
                  </TableHead>
                ))}
                <TableHead className="border border-slate-300 bg-slate-100 text-right">Suma</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
            <SectionHeader title="PRZYCHODY" />
            {visibleImportedIncomeRows.length > 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={months.length + 2} className="border border-slate-300 p-0">
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
                <SpreadsheetRow
                  key={row.id}
                  row={row}
                  months={months}
                  currentMonthKey={currentMonthKey}
                  onUpdateCell={updateCellValue}
                  onOpenFillModal={openFillModal}
                />
              ))}
            {manualIncomeRows.map((row) => (
              <SpreadsheetRow
                key={row.id}
                row={row}
                months={months}
                currentMonthKey={currentMonthKey}
                onUpdateCell={updateCellValue}
                onOpenFillModal={openFillModal}
              />
            ))}
            <SectionAddRow label="+ Dodaj przychód" onClick={() => addRow("income")} colSpan={months.length + 2} />

            <SectionHeader title="WYDATKI" />
            {expenseRows.map((row) => (
              <SpreadsheetRow
                key={row.id}
                row={row}
                months={months}
                currentMonthKey={currentMonthKey}
                onUpdateCell={updateCellValue}
                onOpenFillModal={openFillModal}
              />
            ))}
            <SectionAddRow label="+ Dodaj wydatek" onClick={() => addRow("expense")} colSpan={months.length + 2} />
            </TableBody>
            <TableFooter className="bg-white">
              <SummaryRow label="Miesięczne przychody" values={effectiveMonthlyTotals.map((v) => v.income)} textClass="text-emerald-700" currentMonthKey={currentMonthKey} monthKeys={months.map((m) => m.key)} />
              <SummaryRow label="Prognoza przychodów (auto)" values={forecastIncomeTotals} textClass="text-blue-700" currentMonthKey={currentMonthKey} monthKeys={months.map((m) => m.key)} />
              <SummaryRow label="Miesięczne wydatki" values={effectiveMonthlyTotals.map((v) => v.expenses)} textClass="text-rose-700" currentMonthKey={currentMonthKey} monthKeys={months.map((m) => m.key)} />
              <SummaryRow label="Miesięczne saldo" values={effectiveMonthlyTotals.map((v) => v.balance)} currentMonthKey={currentMonthKey} monthKeys={months.map((m) => m.key)} />
              <SummaryRow label="Stan skumulowany" values={cumulativeBalances.map((v) => v.value)} totalMode="last" currentMonthKey={currentMonthKey} monthKeys={months.map((m) => m.key)} />
              <SummaryRow
                label={(
                  <div className="inline-flex items-center gap-1">
                    <span>Podatek dochodowy spółki (CIT) - płatny miesięcznie</span>
                    <button
                      type="button"
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        const panelWidth = Math.min(340, window.innerWidth - 24);
                        const estimatedPanelHeight = 220;
                        const desiredLeft = rect.left - 18;
                        const maxLeft = Math.max(12, window.innerWidth - panelWidth - 12);
                        const canOpenAbove = rect.top - 12 >= estimatedPanelHeight;
                        const placement: "above" | "below" = canOpenAbove ? "above" : "below";
                        const top = placement === "above" ? rect.top - 6 : rect.bottom + 8;
                        setCitInfoPosition({
                          top,
                          left: Math.max(12, Math.min(desiredLeft, maxLeft)),
                          placement,
                        });
                        setShowVatInfo(false);
                        setShowCitInfo((prev) => !prev);
                      }}
                      aria-label="Sposób liczenia CIT"
                    >
                      <Info className="h-3 w-3" />
                    </button>
                  </div>
                )}
                values={taxTotals.map((v) => v.cit)}
                textClass="text-amber-700"
                currentMonthKey={currentMonthKey}
                monthKeys={months.map((m) => m.key)}
              />
              <SummaryRow
                label={(
                  <div className="inline-flex items-center gap-1">
                    <span>VAT płatny kwartalnie</span>
                    <button
                      type="button"
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                      onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect();
                        const panelWidth = Math.min(340, window.innerWidth - 24);
                        const estimatedPanelHeight = 260;
                        const desiredLeft = rect.left - 18;
                        const maxLeft = Math.max(12, window.innerWidth - panelWidth - 12);
                        const canOpenAbove = rect.top - 12 >= estimatedPanelHeight;
                        const placement: "above" | "below" = canOpenAbove ? "above" : "below";
                        const top = placement === "above" ? rect.top - 6 : rect.bottom + 8;
                        setVatInfoPosition({
                          top,
                          left: Math.max(12, Math.min(desiredLeft, maxLeft)),
                          placement,
                        });
                        setShowCitInfo(false);
                        setShowVatInfo((prev) => !prev);
                      }}
                      aria-label="Sposób liczenia VAT"
                    >
                      <Info className="h-3 w-3" />
                    </button>
                  </div>
                )}
                values={taxTotals.map((v) => v.vatPayment)}
                valueClassBySign
                currentMonthKey={currentMonthKey}
                monthKeys={months.map((m) => m.key)}
              />
              <SummaryRow label="Stan skumulowany po podatkach" values={cumulativeNetAfterTax.map((v) => v.value)} totalMode="last" currentMonthKey={currentMonthKey} monthKeys={months.map((m) => m.key)} />
            </TableFooter>
          </Table>
        </div>
      </div>

      {fillModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-sm border border-slate-300 bg-white p-4 shadow-lg">
            <h3 className="text-sm font-semibold">Wypełnij zakres</h3>
            <p className="mt-1 text-xs text-muted-foreground">Wartość zostanie wpisana do komórek w wybranym przedziale miesięcy.</p>
            <div className="mt-3 space-y-2">
              <div>
                <label className="mb-1 block text-xs font-medium">Nazwa</label>
                <Input value={fillModal.name} onChange={(event) => setFillModal((prev) => (prev ? { ...prev, name: event.target.value } : prev))} className="h-9 text-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Kwota</label>
                <NumericInput
                  value={fillModal.amount}
                  onValueChange={(value) => setFillModal((prev) => (prev ? { ...prev, amount: value } : prev))}
                  className="h-9 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium">Od</label>
                  <Input
                    type="month"
                    value={fillModal.startMonth}
                    onChange={(event) => setFillModal((prev) => (prev ? { ...prev, startMonth: event.target.value } : prev))}
                    className="h-9 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Do</label>
                  <Input
                    type="month"
                    value={fillModal.endMonth}
                    onChange={(event) => setFillModal((prev) => (prev ? { ...prev, endMonth: event.target.value } : prev))}
                    className="h-9 text-sm"
                  />
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <div className="relative">
                {confirmDeleteOpen && (
                  <div className="absolute bottom-full right-0 z-30 mb-2 w-56 rounded-sm border border-slate-300 bg-white p-3 text-xs shadow-[0_12px_24px_rgba(15,23,42,0.16)]">
                    <p className="flex items-center gap-2 text-[13px] font-medium text-slate-800">
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[11px] font-bold leading-none text-white">!</span>
                      Usunąć tę pozycję?
                    </p>
                    <div className="mt-3 flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        className="h-7 rounded-sm border border-slate-300 bg-white px-3 text-xs text-slate-700 hover:bg-slate-50"
                        onClick={() => setConfirmDeleteOpen(false)}
                      >
                        Nie
                      </Button>
                      <Button
                        className="h-7 rounded-sm border border-rose-300 bg-rose-50 px-3 text-xs text-rose-700 hover:bg-rose-100"
                        onClick={() => {
                          deleteRow(fillModal.rowId);
                          setConfirmDeleteOpen(false);
                          setFillModal(null);
                        }}
                      >
                        Tak
                      </Button>
                    </div>
                    <div className="pointer-events-none absolute -bottom-2 right-8 h-0 w-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-slate-300" />
                    <div className="pointer-events-none absolute -bottom-[7px] right-[33px] h-0 w-0 border-l-[7px] border-r-[7px] border-t-[7px] border-l-transparent border-r-transparent border-t-white" />
                  </div>
                )}
                <Button
                  variant="ghost"
                  className="h-8 rounded-sm border border-rose-200 bg-rose-50 px-3 text-rose-700 hover:bg-rose-100"
                  onClick={() => setConfirmDeleteOpen((prev) => !prev)}
                >
                  Usuń pozycję
                </Button>
              </div>
              <Button
                variant="ghost"
                className="h-8 rounded-sm border bg-white px-3"
                onClick={() => {
                  setConfirmDeleteOpen(false);
                  setFillModal(null);
                }}
              >
                Anuluj
              </Button>
              <Button className="h-8 rounded-sm px-3" onClick={saveFillModal}>
                Zapisz
              </Button>
            </div>
          </div>
        </div>
      )}
      {showVatInfo && vatInfoPosition && (
        <div
          className="fixed z-[60] w-[min(340px,calc(100vw-24px))] max-h-[min(320px,calc(100vh-24px))] overflow-y-auto rounded-sm border border-slate-300 bg-white p-3 text-xs font-normal text-slate-700 shadow-[0_12px_24px_rgba(15,23,42,0.16)]"
          style={{
            top: vatInfoPosition.top,
            left: vatInfoPosition.left,
            transform: vatInfoPosition.placement === "above" ? "translateY(-100%)" : "none",
          }}
        >
          <p className="font-semibold">
            VAT za aktualny miesiąc {formatMonthKeyLabel(currentMonthVatInfo.key)}
          </p>
          <p className="mt-2">
            Przychody Fitssey (brutto): <strong>{money.format(currentMonthVatInfo.importedIncomeGross)}</strong>, VAT należny
            (stawka z API lub fallback 8%): <strong>{money.format(currentMonthVatInfo.importedOutputVat)}</strong>
          </p>
          <p className="mt-1">
            Pozostałe przychody (brutto): <strong>{money.format(currentMonthVatInfo.manualIncomeGross)}</strong>, VAT należny
            ({money.format(vatRate)}%): <strong>{money.format(currentMonthVatInfo.manualOutputVat)}</strong>
          </p>
          <p className="mt-1">
            Wydatki (brutto): <strong>{money.format(currentMonthVatInfo.expensesGross)}</strong>, VAT naliczony
            (23%): <strong>{money.format(currentMonthVatInfo.inputVat)}</strong>
          </p>
          <p className="mt-2 font-semibold">
            VAT miesięczny = VAT należny - VAT naliczony = {money.format(currentMonthVatInfo.netVat)}
          </p>
          <p className="mt-1 font-semibold">
            Płatność VAT w tym miesiącu (rozliczenie kwartalne): {money.format(currentMonthVatInfo.vatPayment)}
          </p>
        </div>
      )}
      {showCitInfo && citInfoPosition && (
        <div
          className="fixed z-[60] w-[min(340px,calc(100vw-24px))] max-h-[min(320px,calc(100vh-24px))] overflow-y-auto rounded-sm border border-slate-300 bg-white p-3 text-xs font-normal text-slate-700 shadow-[0_12px_24px_rgba(15,23,42,0.16)]"
          style={{
            top: citInfoPosition.top,
            left: citInfoPosition.left,
            transform: citInfoPosition.placement === "above" ? "translateY(-100%)" : "none",
          }}
        >
          <p className="font-semibold">CIT za aktualny miesiąc {formatMonthKeyLabel(currentMonthCitInfo.key)}</p>
          <p className="mt-2">
            Przychody: <strong>{money.format(currentMonthCitInfo.income)}</strong>
          </p>
          <p className="mt-1">
            Wydatki: <strong>{money.format(currentMonthCitInfo.expenses)}</strong>
          </p>
          <p className="mt-1">
            Saldo miesiąca: <strong>{money.format(currentMonthCitInfo.balance)}</strong>
          </p>
          <p className="mt-1">
            Podstawa CIT narastająco w roku = max(0, wynik YTD): <strong>{money.format(currentMonthCitInfo.taxableBase)}</strong>
          </p>
          <p className="mt-1">
            Podatek należny narastająco: <strong>{money.format(currentMonthCitInfo.citDueYtd)}</strong>
          </p>
          <p className="mt-2 font-semibold">
            Zaliczka CIT za miesiąc = podatek narastająco - wcześniej zapłacone zaliczki = {money.format(currentMonthCitInfo.cit)}
          </p>
        </div>
      )}
    </AppShell>
  );
}

function CashflowColGroup({ months }: { months: MonthColumn[] }) {
  return (
    <colgroup>
      <col style={{ width: "28.5%" }} />
      {months.map((month) => (
        <col key={`col-${month.key}`} style={{ width: "5.5%" }} />
      ))}
      <col style={{ width: "5.5%" }} />
    </colgroup>
  );
}

function SummaryRow({
  label,
  values,
  textClass,
  valueClassBySign,
  totalMode = "sum",
  currentMonthKey,
  monthKeys,
}: {
  label: React.ReactNode;
  values: number[];
  textClass?: string;
  valueClassBySign?: boolean;
  totalMode?: "sum" | "last";
  currentMonthKey?: string;
  monthKeys?: string[];
}) {
  const total = totalMode === "last" ? (values.at(-1) ?? 0) : values.reduce((sum, value) => sum + value, 0);
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell className="border border-slate-300 bg-slate-50 text-xs font-semibold">
        {label}
      </TableCell>
      {values.map((value, index) => (
        <TableCell
          key={index}
          className={`border text-right text-xs font-semibold ${
            monthKeys?.[index] === currentMonthKey ? "border-blue-300 bg-blue-50" : "border-slate-300"
          } ${
            valueClassBySign ? (value >= 0 ? "text-amber-700" : "text-emerald-700") : textClass ?? (value >= 0 ? "text-emerald-700" : "text-rose-700")
          }`}
        >
          {money.format(value)}
        </TableCell>
      ))}
      <TableCell className="border border-slate-300 bg-slate-50 text-right text-xs font-semibold">{money.format(total)}</TableCell>
    </TableRow>
  );
}

type SpreadsheetRowProps = {
  row: FlowRow;
  months: MonthColumn[];
  currentMonthKey: string;
  onUpdateCell: (rowId: string, month: string, value: number) => void;
  onOpenFillModal: (row: FlowRow) => void;
};

function SpreadsheetRow({ row, months, currentMonthKey, onUpdateCell, onOpenFillModal }: SpreadsheetRowProps) {
  const rowTotal = months.reduce((sum, month) => sum + getCellValue(row, month.key), 0);
  const toneClass = row.type === "income" ? "text-emerald-700" : "text-rose-700";
  const readOnlyImported = row.isImported;

  return (
    <TableRow className="hover:bg-transparent">
      <TableCell className="border border-slate-300 p-0">
        <button
          type="button"
          className={`flex h-8 w-full items-center px-2 text-left text-xs ${readOnlyImported ? "cursor-default" : "hover:bg-slate-50"}`}
          onClick={() => {
            if (!readOnlyImported) onOpenFillModal(row);
          }}
        >
          {row.name}
        </button>
      </TableCell>
      {months.map((month) => {
        const value = getCellValue(row, month.key);
        return (
          <TableCell key={month.key} className={`border p-0 ${month.key === currentMonthKey ? "border-blue-300 bg-blue-50/40" : "border-slate-300"}`}>
            {readOnlyImported ? (
              <div className="flex h-8 items-center justify-end px-2 text-xs">{money.format(value)}</div>
            ) : (
              <NumericInput
                value={value}
                onValueChange={(nextValue) => onUpdateCell(row.id, month.key, nextValue)}
                className="h-8 rounded-none border-0 bg-transparent px-1 text-right text-xs"
              />
            )}
          </TableCell>
        );
      })}
      <TableCell className={`border border-slate-300 text-right text-xs font-semibold ${toneClass}`}>{money.format(rowTotal)}</TableCell>
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
  const value = row.monthValues[month];
  return typeof value === "number" ? value : 0;
}

function monthKeyFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthKeyLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  return `${month}/${year}`;
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
