"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AppShell } from "@/components/app-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type DashboardPayload = {
  studioUuid?: string;
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
  passesSoldByMonth?: Record<string, number>;
  newClientsByMonth: Record<string, number>;
  returningClientsByMonth: Record<string, number>;
  productCount: Record<string, number>;
  activeClientsByMonth: Record<string, number>;
  dailyRevenue: { labels: string[]; values: number[]; previousValues: number[] };
  contacts: {
    name: string;
    clientGuid: string | null;
    lastPurchaseDate: string;
    daysSinceLastPurchase: number;
    lastPassPurchaseDate: string | null;
    daysSinceLastPass: number | null;
    expectedCycleDays: number | null;
    lifetimeRevenue: number;
    email: string | null;
    phone: string | null;
    reason: string;
    score: number;
    priority: string;
  }[];
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
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

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
    const passesSoldByMonth = data.passesSoldByMonth ?? {};
    return data.months.map((month) => ({
      month: formatMonthKey(month),
      revenue: Math.round(data.revenueByMonth[month] ?? 0),
      passesSold: passesSoldByMonth[month] ?? 0,
      newClients: data.newClientsByMonth[month] ?? 0,
      returningClients: data.returningClientsByMonth[month] ?? 0,
      activeClients: data.activeClientsByMonth[month] ?? 0,
    }));
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
    <AppShell title="Dashboard">
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

          <section className="grid gap-3">
            <ChartCard title="Przychód miesięczny">
              <ChartWrap>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart accessibilityLayer={false} data={monthlyChartData} margin={{ top: 6, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.1)" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#667085" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11, fill: "#667085" }} tickLine={false} axisLine={false} width={44} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(value) => [money.format(Number(value || 0)), "Przychód"]} />
                    <Bar dataKey="revenue" fill="#635bff" radius={[6, 6, 0, 0]}>
                      <LabelList dataKey="revenue" position="top" formatter={(value) => money.format(Number(value || 0))} fill="#0f172a" fontSize={11} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartWrap>
            </ChartCard>

            <ChartCard title="Sprzedane karnety miesięcznie">
              <ChartWrap>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart accessibilityLayer={false} data={monthlyChartData} margin={{ top: 6, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.1)" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#667085" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11, fill: "#667085" }} tickLine={false} axisLine={false} width={44} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(value) => [String(value ?? 0), "Sprzedane karnety"]} />
                    <Bar dataKey="passesSold" fill="#0ea5e9" radius={[6, 6, 0, 0]}>
                      <LabelList dataKey="passesSold" position="top" formatter={(value) => String(value ?? 0)} fill="#0f172a" fontSize={11} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartWrap>
            </ChartCard>

            <ChartCard title="Nowi klienci">
              <ChartWrap tall>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart accessibilityLayer={false} data={monthlyChartData} margin={{ top: 6, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.1)" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#667085" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11, fill: "#667085" }} tickLine={false} axisLine={false} width={44} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(value) => [String(value ?? 0), "Nowi klienci"]} />
                    <Bar dataKey="newClients" fill="#22c55e" name="Nowi klienci" radius={[4, 4, 0, 0]}>
                      <LabelList dataKey="newClients" position="top" formatter={(value) => String(value ?? 0)} fill="#0f172a" fontSize={11} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartWrap>
            </ChartCard>

            <ChartCard title="Powracający klienci">
              <ChartWrap tall>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart accessibilityLayer={false} data={monthlyChartData} margin={{ top: 6, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.1)" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#667085" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11, fill: "#667085" }} tickLine={false} axisLine={false} width={44} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(value) => [String(value ?? 0), "Powracający klienci"]} />
                    <Bar dataKey="returningClients" fill="#f59e0b" name="Powracający klienci" radius={[4, 4, 0, 0]}>
                      <LabelList dataKey="returningClients" position="top" formatter={(value) => String(value ?? 0)} fill="#0f172a" fontSize={11} />
                    </Bar>
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
                    <Bar dataKey="current" fill="#8b5cf6" name="Aktualny miesiąc" radius={[4, 4, 0, 0]}>
                      {!isMobile && <LabelList dataKey="current" position="top" formatter={(value) => money.format(Number(value || 0))} fill="#0f172a" fontSize={11} />}
                    </Bar>
                    <Bar dataKey="previous" fill="#0ea5e9" name="Ten sam dzień poprzedniego miesiąca" radius={[4, 4, 0, 0]}>
                      {!isMobile && <LabelList dataKey="previous" position="top" formatter={(value) => money.format(Number(value || 0))} fill="#0f172a" fontSize={11} />}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartWrap>
            </ChartCard>

          </section>

          <TableCard title="Klienci do kontaktu">
            <ContactsTable rows={data.contacts} studioUuid={data.studioUuid} />
          </TableCard>

          <TableCard title="Wszyscy klienci">
            <ClientsTable rows={data.clientsSummary} months={data.months.slice(-3)} />
          </TableCard>
        </div>
      )}
    </AppShell>
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

function ContactsTable({
  rows,
  studioUuid,
}: {
  rows: {
    name: string;
    clientGuid: string | null;
    lastPurchaseDate: string;
    daysSinceLastPurchase: number;
    lastPassPurchaseDate: string | null;
    daysSinceLastPass: number | null;
    expectedCycleDays: number | null;
    lifetimeRevenue: number;
    email: string | null;
    phone: string | null;
    reason: string;
    score: number;
    priority: string;
  }[];
  studioUuid?: string;
}) {
  return (
    <>
      <div className="space-y-2 md:hidden">
        {rows.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-muted-foreground">
            Brak klientów do kontaktu.
          </div>
        ) : (
          rows.map((row) => (
            <div
              key={`mobile-${row.name}-${row.lastPurchaseDate}`}
              className={`rounded-xl border px-3 py-2 text-xs ${
                row.priority === "wysoki"
                  ? "border-rose-200 bg-rose-50/60"
                  : row.priority === "sredni"
                    ? "border-amber-200 bg-amber-50/60"
                    : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-slate-800">
                  <ClientNameLink name={row.name} studioUuid={studioUuid} clientGuid={row.clientGuid} />
                </p>
                <span className={getPriorityBadgeClass(row.priority)}>{formatPriority(row.priority)}</span>
              </div>
              <p className="mt-1 text-slate-600">{row.reason}</p>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-slate-600">
                <span>Ost. zakup:</span>
                <span className="text-right">{new Date(row.lastPurchaseDate).toLocaleDateString("pl-PL")}</span>
                <span>Dni bez zakupu:</span>
                <span className="text-right">{row.daysSinceLastPurchase}</span>
                <span>Ost. karnet:</span>
                <span className="text-right">{row.lastPassPurchaseDate ? new Date(row.lastPassPurchaseDate).toLocaleDateString("pl-PL") : "-"}</span>
                <span>Cykl:</span>
                <span className="text-right">{row.expectedCycleDays ?? "-"}</span>
                <span>LTV:</span>
                <span className="text-right">{money.format(row.lifetimeRevenue)}</span>
                <span>Score:</span>
                <span className="text-right font-semibold text-slate-800">{row.score}</span>
              </div>
              <div className="mt-2 space-y-1 border-t border-slate-200 pt-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Email:</span>
                  <div className="max-w-[170px] truncate text-right">
                    <ContactValueLink type="email" value={row.email} />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Telefon:</span>
                  <div className="max-w-[170px] truncate text-right">
                    <ContactValueLink type="phone" value={row.phone} />
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="hidden max-w-full overflow-x-auto md:block">
        <Table className="min-w-[980px] text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>Klient</TableHead>
              <TableHead>Ostatni zakup</TableHead>
              <TableHead className="text-right">Dni bez zakupu</TableHead>
              <TableHead>Ostatni karnet</TableHead>
              <TableHead className="text-right">Cykl</TableHead>
              <TableHead>Powod kontaktu</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Telefon</TableHead>
              <TableHead className="text-right">LTV</TableHead>
              <TableHead className="text-right">Score</TableHead>
              <TableHead>Priorytet</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-muted-foreground">
                  Brak klientów do kontaktu.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={`${row.name}-${row.lastPurchaseDate}`} className={row.priority === "wysoki" ? "bg-rose-50/60" : row.priority === "sredni" ? "bg-amber-50/60" : ""}>
                  <TableCell>
                    <ClientNameLink name={row.name} studioUuid={studioUuid} clientGuid={row.clientGuid} />
                  </TableCell>
                  <TableCell>{new Date(row.lastPurchaseDate).toLocaleDateString("pl-PL")}</TableCell>
                  <TableCell className="text-right">{row.daysSinceLastPurchase}</TableCell>
                  <TableCell>{row.lastPassPurchaseDate ? new Date(row.lastPassPurchaseDate).toLocaleDateString("pl-PL") : "-"}</TableCell>
                  <TableCell className="text-right">{row.expectedCycleDays ?? "-"}</TableCell>
                  <TableCell>{row.reason}</TableCell>
                  <TableCell>
                    <div className="max-w-[220px] truncate">
                      <ContactValueLink type="email" value={row.email} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[170px] truncate">
                      <ContactValueLink type="phone" value={row.phone} />
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{money.format(row.lifetimeRevenue)}</TableCell>
                  <TableCell className="text-right">{row.score}</TableCell>
                  <TableCell>
                    <span className={getPriorityBadgeClass(row.priority)}>{formatPriority(row.priority)}</span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function ClientNameLink({
  name,
  studioUuid,
  clientGuid,
}: {
  name: string;
  studioUuid?: string;
  clientGuid?: string | null;
}) {
  if (!studioUuid || !clientGuid) return <>{name}</>;
  const href = `https://app.fitssey.com/${encodeURIComponent(studioUuid)}/backoffice.v4/client/${encodeURIComponent(clientGuid)}/`;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-slate-900 underline decoration-slate-300 underline-offset-2 hover:text-sky-700 hover:decoration-sky-400">
      {name}
    </a>
  );
}

function ContactValueLink({
  type,
  value,
}: {
  type: "email" | "phone";
  value: string | null | undefined;
}) {
  const normalized = String(value ?? "").trim();
  const hasValue = normalized.length > 0;
  const href = type === "email"
    ? `mailto:${normalized}`
    : `tel:${normalized.replace(/[^\d+]/g, "")}`;

  if (!hasValue) {
    return <span className="text-slate-400">-</span>;
  }

  return (
    <a
      href={href}
      className="text-slate-700 underline decoration-slate-300 underline-offset-2 hover:text-sky-700 hover:decoration-sky-400"
    >
      {normalized}
    </a>
  );
}

function formatMonthKey(monthKey: string) {
  const [year, month] = monthKey.split("-");
  return `${month}/${year}`;
}

function getPriorityBadgeClass(priority: string) {
  if (priority === "wysoki") return "inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700";
  if (priority === "sredni") return "inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700";
  return "inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700";
}

function formatPriority(priority: string) {
  if (priority === "sredni") return "sredni";
  return priority;
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
