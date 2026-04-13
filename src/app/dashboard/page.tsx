"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AppShell } from "@/components/app-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type DashboardPayload = {
  months: string[];
  latestMonth: string | null;
  latestMrr: number;
  latestArpu: number;
  latestChurn: number;
  latestActive: number;
  currentPeriodRevenue: number;
  previousPeriodRevenue: number;
  previousFullMonthRevenue: number;
  revenueMoMChange: number | null;
  revenueByMonth: Record<string, number>;
  mrrByMonth: Record<string, number>;
  newClientsByMonth: Record<string, number>;
  returningClientsByMonth: Record<string, number>;
  productCount: Record<string, number>;
  activeClientsByMonth: Record<string, number>;
  dailyRevenue: { labels: string[]; values: number[]; previousValues: number[] };
  newClientSales: { month: string; date: string; clientName: string; product: string; amount: number; monthLinkStatus: string }[];
  returningClientSales: { month: string; date: string; clientName: string; product: string; amount: number; monthLinkStatus: string }[];
  clientsSummary: { name: string; purchaseCount: number; totalAmount: number; purchasesByMonth: Record<string, number> }[];
  error?: string;
};

const money = new Intl.NumberFormat("pl-PL", { style: "decimal", maximumFractionDigits: 0 });
const tooltipStyle = {
  background: "#ffffff",
  border: "1px solid rgba(15, 23, 42, 0.12)",
  borderRadius: "12px",
  boxShadow: "0 12px 28px rgba(15, 23, 42, 0.12)",
  fontSize: "12px",
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError("");
      try {
        const response = await fetch("/api/fitssey/dashboard");
        const payload = (await response.json().catch(() => ({}))) as DashboardPayload;
        if (!response.ok) {
          setError(payload.error ?? "Nie udało się pobrać dashboardu Fitssey.");
          return;
        }
        setData(payload);
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, []);

  const monthlyChartData = useMemo(() => {
    if (!data) return [];
    return data.months.map((month) => ({
      month: formatMonthKey(month),
      revenue: Math.round(data.revenueByMonth[month] ?? 0),
      mrr: Math.round(data.mrrByMonth[month] ?? 0),
      newClients: data.newClientsByMonth[month] ?? 0,
      returningClients: data.returningClientsByMonth[month] ?? 0,
      activeClients: data.activeClientsByMonth[month] ?? 0,
    }));
  }, [data]);

  const productsData = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.productCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name: trimText(name, 28), count }));
  }, [data]);

  const dailyChartData = useMemo(() => {
    if (!data) return [];
    return data.dailyRevenue.labels.map((day, index) => ({
      day,
      current: Math.round(data.dailyRevenue.values[index] ?? 0),
      previous: Math.round(data.dailyRevenue.previousValues[index] ?? 0),
    }));
  }, [data]);

  return (
    <AppShell title="Dashboard" subtitle="Wykresy i tabele sprzedażowe Fitssey (styl i układ jak w starym dashboardzie).">
      {isLoading ? (
        <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-4 text-sm text-muted-foreground shadow-[0_12px_32px_rgba(11,22,39,0.06)] backdrop-blur-sm">
          Ładowanie dashboardu...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      ) : !data ? null : (
        <div className="fitssey-dashboard grid gap-4">
          <section className="rounded-2xl border border-slate-200/70 bg-[radial-gradient(140%_120%_at_0%_0%,rgba(139,140,255,0.30),rgba(203,236,255,0.28),rgba(255,255,255,0.6))] p-4 shadow-[0_12px_32px_rgba(11,22,39,0.06)]">
            <div className="mb-4 rounded-2xl border border-slate-200/70 bg-white/85 px-5 py-4">
              <p className="text-xs font-extrabold tracking-[0.06em] text-sky-600 sm:text-sm">REFORMA DASHBOARD</p>
            </div>
            <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-4 shadow-[0_8px_20px_rgba(11,22,39,0.05)]">
              <p className="mb-3 text-lg font-extrabold leading-tight text-slate-800 sm:text-xl">Przychód miesiąc do miesiąca</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <SummaryTile
                  label="Aktualny miesiąc"
                  value={money.format(data.currentPeriodRevenue)}
                  sublabel={formatPeriodLabel(new Date(new Date().getFullYear(), new Date().getMonth(), 1), new Date())}
                />
                <SummaryTile
                  label="Poprzedni miesiąc (cały)"
                  value={money.format(data.previousFullMonthRevenue)}
                  sublabel={formatPreviousMonthFullLabel()}
                />
                <SummaryTile
                  label="Poprzedni do tego dnia"
                  value={money.format(data.previousPeriodRevenue)}
                  sublabel={formatPreviousComparableLabel(new Date())}
                />
                <SummaryTile
                  label="Zmiana m/m"
                  value={data.revenueMoMChange == null ? "—" : `${data.revenueMoMChange >= 0 ? "▲" : "▼"} ${Math.abs(data.revenueMoMChange).toFixed(1)}%`}
                  valueClass={data.revenueMoMChange == null ? "text-slate-800" : data.revenueMoMChange >= 0 ? "text-emerald-700" : "text-rose-700"}
                  sublabel="vs poprzedni miesiąc"
                />
              </div>
            </div>
          </section>

          <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="MRR" value={money.format(data.latestMrr)} />
            <StatCard label="ARPU" value={money.format(data.latestArpu)} />
            <StatCard label="Aktywni klienci" value={String(data.latestActive)} />
            <StatCard label="Churn" value={`${data.latestChurn.toFixed(1)}%`} />
          </section>

          <section className="grid gap-3 xl:grid-cols-2">
            <ChartCard title="Przychód miesięczny">
              <ChartWrap>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart accessibilityLayer={false} data={monthlyChartData} margin={{ top: 6, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.1)" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#667085" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11, fill: "#667085" }} tickLine={false} axisLine={false} width={44} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(value) => [money.format(Number(value || 0)), "Przychód"]} />
                    <Bar dataKey="revenue" fill="#635bff" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartWrap>
            </ChartCard>

            <ChartCard title="MRR i trend miesięczny">
              <ChartWrap>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart accessibilityLayer={false} data={monthlyChartData} margin={{ top: 6, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.1)" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#667085" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11, fill: "#667085" }} tickLine={false} axisLine={false} width={44} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(value) => [money.format(Number(value || 0)), "MRR"]} />
                    <Line type="monotone" dataKey="mrr" stroke="#0ea5e9" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartWrap>
            </ChartCard>

            <ChartCard title="Sprzedaż wg produktu (TOP 8)">
              <ChartWrap tall>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart accessibilityLayer={false} data={productsData} layout="vertical" margin={{ top: 6, right: 8, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.1)" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#667085" }} tickLine={false} axisLine={false} />
                    <YAxis dataKey="name" type="category" width={170} tick={{ fontSize: 11, fill: "#475467" }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(value) => [String(value), "Liczba sprzedaży"]} />
                    <Bar dataKey="count" fill="#635bff" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartWrap>
            </ChartCard>

            <ChartCard title="Nowi vs powracający klienci">
              <ChartWrap tall>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart accessibilityLayer={false} data={monthlyChartData} margin={{ top: 6, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.1)" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#667085" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11, fill: "#667085" }} tickLine={false} axisLine={false} width={44} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="newClients" stackId="a" fill="#0ea5e9" name="Nowi" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="returningClients" stackId="a" fill="#22c55e" name="Powracający" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartWrap>
            </ChartCard>

            <ChartCard title="Przychód dzienny">
              <ChartWrap tall>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart accessibilityLayer={false} data={dailyChartData} margin={{ top: 6, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.1)" />
                    <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#667085" }} tickLine={false} axisLine={false} interval={2} />
                    <YAxis tick={{ fontSize: 11, fill: "#667085" }} tickLine={false} axisLine={false} width={44} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="current" fill="#8b5cf6" name="Aktualny miesiąc" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="previous" fill="#0ea5e9" name="Ten sam dzień poprzedniego miesiąca" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartWrap>
            </ChartCard>

            <ChartCard title="Aktywni klienci w czasie">
              <ChartWrap tall>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart accessibilityLayer={false} data={monthlyChartData} margin={{ top: 6, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.1)" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#667085" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11, fill: "#667085" }} tickLine={false} axisLine={false} width={44} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(value) => [String(value), "Aktywni klienci"]} />
                    <Line type="monotone" dataKey="activeClients" stroke="#6366f1" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartWrap>
            </ChartCard>
          </section>

          <TableCard title="Nowi klienci - sprzedaż">
            <SalesTable rows={data.newClientSales} tableType="new" />
          </TableCard>

          <TableCard title="Powracający klienci - sprzedaż">
            <SalesTable rows={data.returningClientSales} tableType="returning" />
          </TableCard>

          <TableCard title="Wszyscy klienci">
            <ClientsTable rows={data.clientsSummary} months={data.months.slice(-3)} />
          </TableCard>
        </div>
      )}
    </AppShell>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-[0_12px_32px_rgba(11,22,39,0.06)] backdrop-blur-sm">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  sublabel,
  valueClass,
}: {
  label: string;
  value: string;
  sublabel: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-[#f8fafc]/80 px-4 py-3">
      <p className="text-[11px] font-bold leading-tight text-slate-500 sm:text-xs">{label}</p>
      <p className={`mt-1 text-xl font-extrabold leading-none sm:text-2xl ${valueClass ?? "text-slate-800"}`}>{value}</p>
      <p className="mt-1 text-[11px] text-slate-500 sm:text-xs">{sublabel}</p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-[0_12px_32px_rgba(11,22,39,0.06)] backdrop-blur-sm">
      <h3 className="mb-2 text-sm font-semibold text-slate-800">{title}</h3>
      {children}
    </div>
  );
}

function ChartWrap({ children, tall }: { children: React.ReactNode; tall?: boolean }) {
  return <div className={tall ? "h-[280px] sm:h-[300px]" : "h-[240px] sm:h-[270px]"}>{children}</div>;
}

function TableCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-[0_12px_32px_rgba(11,22,39,0.06)] backdrop-blur-sm">
      <h3 className="mb-2 text-sm font-semibold text-slate-800">{title}</h3>
      {children}
    </div>
  );
}

function SalesTable({
  rows,
  tableType,
}: {
  rows: { month: string; date: string; clientName: string; product: string; amount: number; monthLinkStatus: string }[];
  tableType: "new" | "returning";
}) {
  return (
    <div className="max-w-full overflow-x-auto">
      <Table className="min-w-[760px] text-xs">
        <TableHeader>
          <TableRow>
            <TableHead>Miesiąc</TableHead>
            <TableHead>Data</TableHead>
            <TableHead>Klient</TableHead>
            <TableHead>Produkt</TableHead>
            <TableHead className="text-right">Kwota</TableHead>
            <TableHead>Powiązanie m/m</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground">
                Brak danych.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row, index) => (
              <TableRow key={`${row.clientName}-${row.date}-${index}`} className={getSalesRowClass(row.monthLinkStatus)}>
                <TableCell>{formatMonthKey(row.month)}</TableCell>
                <TableCell>{new Date(row.date).toLocaleString("pl-PL")}</TableCell>
                <TableCell>{row.clientName}</TableCell>
                <TableCell>{row.product}</TableCell>
                <TableCell className="text-right">{money.format(row.amount)}</TableCell>
                <TableCell>
                  <span className={getSalesBadgeClass(row.monthLinkStatus)}>
                    {formatMonthLinkLabel(row.monthLinkStatus, tableType)}
                  </span>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function ClientsTable({
  rows,
  months,
}: {
  rows: { name: string; purchaseCount: number; totalAmount: number; purchasesByMonth: Record<string, number> }[];
  months: string[];
}) {
  return (
    <div className="max-w-full overflow-x-auto">
      <Table className="min-w-[860px] text-xs">
        <TableHeader>
          <TableRow>
            <TableHead>Imię i nazwisko</TableHead>
            <TableHead className="text-right">Ilość zakupów</TableHead>
            <TableHead className="text-right">Suma zakupów</TableHead>
            {months.map((month) => (
              <TableHead key={month} className="text-right">
                {formatMonthKey(month)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3 + months.length} className="text-muted-foreground">
                Brak danych.
              </TableCell>
            </TableRow>
          ) : (
            rows.slice(0, 100).map((row) => (
              <TableRow key={row.name}>
                <TableCell>{row.name}</TableCell>
                <TableCell className="text-right">{row.purchaseCount}</TableCell>
                <TableCell className="text-right">{money.format(row.totalAmount)}</TableCell>
                {months.map((month) => (
                  <TableCell key={`${row.name}-${month}`} className="text-right">
                    {row.purchasesByMonth[month] || "-"}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function formatMonthKey(monthKey: string) {
  const [year, month] = monthKey.split("-");
  return `${month}/${year}`;
}

function trimText(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}...`;
}

function formatMonthLinkLabel(status: string, tableType: "new" | "returning") {
  if (tableType === "new" && status.includes("Brak zakupu w poprzednim")) {
    return "—";
  }
  return status;
}

function getSalesRowClass(status: string) {
  if (status.includes("Brak zakupu w aktualnym")) {
    return "bg-rose-50/70";
  }
  if (status.includes("Kupował też w poprzednim") || status.includes("Kupił też w aktualnym")) {
    return "bg-emerald-50/60";
  }
  return "";
}

function getSalesBadgeClass(status: string) {
  if (status.includes("Brak zakupu w aktualnym")) {
    return "inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700";
  }
  if (status.includes("Kupował też w poprzednim") || status.includes("Kupił też w aktualnym")) {
    return "inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700";
  }
  return "inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600";
}

function formatPeriodLabel(start: Date, end: Date) {
  return `${formatDayMonth(start)} - ${formatDayMonth(end)}`;
}

function formatPreviousMonthFullLabel() {
  const now = new Date();
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const start = new Date(previous.getFullYear(), previous.getMonth(), 1);
  const end = new Date(previous.getFullYear(), previous.getMonth() + 1, 0);
  return formatPeriodLabel(start, end);
}

function formatPreviousComparableLabel(now: Date) {
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const start = new Date(previous.getFullYear(), previous.getMonth(), 1);
  const endDay = Math.min(now.getDate(), new Date(previous.getFullYear(), previous.getMonth() + 1, 0).getDate());
  const end = new Date(previous.getFullYear(), previous.getMonth(), endDay);
  return formatPeriodLabel(start, end);
}

function formatDayMonth(date: Date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}`;
}
