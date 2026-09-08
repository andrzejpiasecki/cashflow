"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, PartyPopper, Search } from "lucide-react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { AppShell } from "@/components/app-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type DashboardPayload = {
  studioUuid?: string;
  welcomeSmsMessage?: string;
  smsTemplates?: SmsTemplate[];
  months: string[];
  latestMonth: string | null;
  latestMrr: number;
  latestArpu: number;
  latestChurn: number;
  latestActive: number;
  totalRevenue: number;
  currentFitsseyRevenue: number;
  currentManualRevenue: number;
  totalExpenses: number;
  totalNet: number;
  currentMonthRevenue: number;
  currentMonthExpenses: number;
  currentMonthNet: number;
  previousMonthRevenue: number;
  previousMonthExpenses: number;
  previousMonthNet: number;
  currentPeriodRevenue: number;
  previousPeriodRevenue: number;
  previousFullMonthRevenue: number;
  revenueMoMChange: number | null;
  revenueByMonth: Record<string, number>;
  expensesByMonth: Record<string, number>;
  netByMonth: Record<string, number>;
  mrrByMonth: Record<string, number>;
  passesSoldByMonth?: Record<string, number>;
  newClientsByMonth: Record<string, number>;
  returningClientsByMonth: Record<string, number>;
  productCount: Record<string, number>;
  chartProducts?: string[];
  activeClientsByMonth: Record<string, number>;
  dailyRevenue: { labels: string[]; values: number[]; previousValues: number[] };
  recentPurchases: {
    date: string;
    clientName: string;
    clientGuid: string | null;
    phone: string | null;
    product: string;
    amount: number;
    isNewClient: boolean;
  }[];
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
  promotionCampaigns: PromotionCampaign[];
  clientsSummary: { name: string; purchaseCount: number; totalAmount: number; purchasesByMonth: Record<string, number> }[];
  error?: string;
};

type SmsTemplate = {
  id: string;
  label: string;
  message: string;
};

type PromotionCampaign = {
  productName: string;
  buyers: number;
  purchases: number;
  retained: number;
  pending: number;
  inactiveAfterFollowUp: number;
  evaluatedBuyers: number;
  lost: number;
  retentionRate: number;
  campaignRevenue: number;
  followUpRevenue: number;
  topNextProducts: { name: string; count: number }[];
  rows: {
    name: string;
    clientGuid: string | null;
    phone: string | null;
    purchaseDate: string;
    campaignAmount: number;
    retained: boolean;
    pending: boolean;
    inactiveAfterFollowUp: boolean;
    daysSinceCampaignPurchase: number;
    lastPurchaseDate: string;
    daysSinceLastPurchase: number;
    nextPurchaseDate: string | null;
    daysToNextPurchase: number | null;
    nextProduct: string | null;
    followUpProducts: string[];
    followUpRevenue: number;
  }[];
};

type PromotionCampaignSortKey = "name" | "purchaseDate" | "campaignAmount" | "status" | "daysSinceLastPurchase" | "nextProduct" | "daysToNextPurchase" | "followUpProducts" | "followUpRevenue";
type SortDirection = "asc" | "desc";

const money = new Intl.NumberFormat("pl-PL", { style: "decimal", maximumFractionDigits: 0 });
const tooltipStyle = {
  background: "#ffffff",
  border: "1px solid rgba(15, 23, 42, 0.12)",
  borderRadius: "12px",
  boxShadow: "0 12px 28px rgba(15, 23, 42, 0.12)",
  fontSize: "12px",
};
const chartMargin = { top: 24, right: 10, left: -10, bottom: 0 };

function buildDashboardUrl(params: URLSearchParams) {
  const query = params.toString();
  return query ? `/api/fitssey/dashboard?${query}` : "/api/fitssey/dashboard";
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [selectedPromotionProduct, setSelectedPromotionProduct] = useState("");
  const [selectedChartProducts, setSelectedChartProducts] = useState<string[]>([]);
  const [draftChartProducts, setDraftChartProducts] = useState<string[]>([]);
  const [areChartsLoading, setAreChartsLoading] = useState(false);
  const [dashboardRefreshVersion, setDashboardRefreshVersion] = useState(0);
  const hasLoadedDashboard = useRef(false);
  const appliedChartProducts = useRef<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      if (hasLoadedDashboard.current) setAreChartsLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        for (const product of selectedChartProducts) params.append("product", product);
        const response = await fetch(buildDashboardUrl(params), { signal: controller.signal });
        const payload = (await response.json().catch(() => ({}))) as DashboardPayload;
        if (!response.ok) {
          setError(payload.error ?? "Nie udało się pobrać dashboardu Fitssey.");
          const fallbackProducts = response.status === 400 ? [] : appliedChartProducts.current;
          setSelectedChartProducts(fallbackProducts);
          setDraftChartProducts(fallbackProducts);
          return;
        }
        setData(payload);
        appliedChartProducts.current = selectedChartProducts;
      } catch (loadError) {
        if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setError("Nie udało się pobrać dashboardu Fitssey.");
          setSelectedChartProducts(appliedChartProducts.current);
          setDraftChartProducts(appliedChartProducts.current);
        }
      } finally {
        if (!controller.signal.aborted) {
          hasLoadedDashboard.current = true;
          setIsLoading(false);
          setAreChartsLoading(false);
        }
      }
    };
    void load();
    return () => controller.abort();
  }, [dashboardRefreshVersion, selectedChartProducts]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const reloadAfterAutoImport = () => setDashboardRefreshVersion((version) => version + 1);

    window.addEventListener("fitssey:auto-import-completed", reloadAfterAutoImport);
    return () => window.removeEventListener("fitssey:auto-import-completed", reloadAfterAutoImport);
  }, []);

  const monthlyChartData = useMemo(() => {
    if (!data) return [];
    const passesSoldByMonth = data.passesSoldByMonth ?? {};
    return data.months.map((month) => ({
      month: formatMonthKey(month),
      revenue: Math.round(data.revenueByMonth[month] ?? 0),
      expenses: Math.round(data.expensesByMonth[month] ?? 0),
      net: Math.round(data.netByMonth[month] ?? 0),
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

  const selectedPromotionCampaign = useMemo(() => {
    if (!data?.promotionCampaigns?.length) return null;
    return data.promotionCampaigns.find((campaign) => campaign.productName === selectedPromotionProduct) ?? data.promotionCampaigns[0];
  }, [data, selectedPromotionProduct]);

  const toggleChartProduct = (product: string) => {
    setDraftChartProducts((current) => current.includes(product)
      ? current.filter((selectedProduct) => selectedProduct !== product)
      : [...current, product]);
  };

  return (
    <AppShell title="Dashboard">
      {isLoading ? (
        <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-4 text-sm text-muted-foreground shadow-[0_12px_32px_rgba(11,22,39,0.06)] backdrop-blur-sm">
          Ładowanie dashboardu...
        </div>
      ) : !data ? (
        error ? <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700">{error}</div> : null
      ) : (
        <div className="fitssey-dashboard grid gap-4">
          {error && <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}
          <ChartProductFilter
            products={data.chartProducts ?? []}
            selectedProducts={draftChartProducts}
            appliedProducts={selectedChartProducts}
            isLoading={areChartsLoading}
            onApply={() => setSelectedChartProducts(draftChartProducts)}
            onClear={() => setDraftChartProducts([])}
            onToggle={toggleChartProduct}
          />

          <section className={`rounded-2xl border border-slate-200/70 bg-[radial-gradient(140%_120%_at_0%_0%,rgba(139,140,255,0.30),rgba(203,236,255,0.28),rgba(255,255,255,0.6))] p-4 shadow-[0_12px_32px_rgba(11,22,39,0.06)] transition-opacity ${areChartsLoading ? "opacity-60" : ""}`}>
            <div className="mb-4 rounded-2xl border border-slate-200/70 bg-white/85 px-5 py-4">
              <p className="text-xs font-extrabold tracking-[0.06em] text-sky-600 sm:text-sm">REFORMA DASHBOARD</p>
            </div>
            <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-4 shadow-[0_8px_20px_rgba(11,22,39,0.05)]">
              <p className="mb-3 text-lg font-extrabold leading-tight text-slate-800 sm:text-xl">Przychód</p>
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
                <SummaryTile
                  label="Przychód Fitssey"
                  value={money.format(data.currentFitsseyRevenue)}
                  sublabel="aktualny miesiąc"
                />
                <SummaryTile
                  label="Przychód ręczny"
                  value={money.format(data.currentManualRevenue)}
                  sublabel="aktualny miesiąc"
                />
              </div>
            </div>
          </section>

          <section className={`grid gap-3 transition-opacity ${areChartsLoading ? "opacity-60" : ""}`}>
            <ChartCard title="Przychód miesięczny">
              <ChartWrap>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart accessibilityLayer={false} data={monthlyChartData} margin={chartMargin}>
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
                  <BarChart accessibilityLayer={false} data={monthlyChartData} margin={chartMargin}>
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
                  <BarChart accessibilityLayer={false} data={monthlyChartData} margin={chartMargin}>
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
                  <BarChart accessibilityLayer={false} data={monthlyChartData} margin={chartMargin}>
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
                  <BarChart accessibilityLayer={false} data={dailyChartData} margin={chartMargin}>
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

            <TableCard title="Ostatnie 20 zakupów">
              <RecentPurchasesTable rows={data.recentPurchases ?? []} studioUuid={data.studioUuid} smsTemplates={data.smsTemplates} welcomeSmsMessage={data.welcomeSmsMessage} />
            </TableCard>

          </section>

          <PromotionCampaignSection
            key={selectedPromotionCampaign?.productName ?? "none"}
            campaigns={data.promotionCampaigns ?? []}
            selectedCampaign={selectedPromotionCampaign}
            selectedProduct={selectedPromotionCampaign?.productName ?? ""}
            studioUuid={data.studioUuid}
            smsTemplates={data.smsTemplates}
            welcomeSmsMessage={data.welcomeSmsMessage}
            onSelectProduct={setSelectedPromotionProduct}
          />

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

function ChartProductFilter({
  products,
  selectedProducts,
  appliedProducts,
  isLoading,
  onApply,
  onClear,
  onToggle,
}: {
  products: string[];
  selectedProducts: string[];
  appliedProducts: string[];
  isLoading: boolean;
  onApply: () => void;
  onClear: () => void;
  onToggle: (product: string) => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const hasChanges = !haveSameProducts(selectedProducts, appliedProducts);
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase("pl-PL");
  const filteredProducts = normalizedSearchQuery
    ? products.filter((product) => product.toLocaleLowerCase("pl-PL").includes(normalizedSearchQuery))
    : products;
  const selectionLabel = selectedProducts.length === 0
    ? "Wszystkie"
    : selectedProducts.length === 1
      ? selectedProducts[0]
      : `${selectedProducts.length} wybrane`;

  return (
    <div className="relative z-30 rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-[0_12px_32px_rgba(11,22,39,0.06)] backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-800">Produkty uwzględniane na wykresach</p>
          <p className="text-xs text-slate-500">Filtr dotyczy części przychodów z Fitssey oraz statystyk klientów. Ręczne przychody i wszystkie koszty pozostają uwzględnione.</p>
        </div>
        {isLoading && <span className="text-xs font-semibold text-sky-700" role="status">Przeliczanie...</span>}
      </div>
      <details ref={detailsRef} className="group relative mt-3 max-w-xl">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none marker:hidden focus:border-sky-400 focus:ring-2 focus:ring-sky-100">
          <span className="truncate">{selectionLabel}</span>
          <span className="text-xs text-slate-500 group-open:rotate-180" aria-hidden="true">▼</span>
        </summary>
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="max-h-64 overflow-y-auto p-2">
            <label className="relative mb-1 block">
              <span className="sr-only">Szukaj produktu</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Szukaj produktu..."
                className="min-h-9 w-full rounded-lg border border-slate-200 bg-white py-1.5 pr-3 pl-8 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              />
            </label>
            <button
              type="button"
              aria-pressed={selectedProducts.length === 0}
              onClick={onClear}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-semibold hover:bg-slate-50 ${selectedProducts.length === 0 ? "text-sky-700" : "text-slate-800"}`}
            >
              <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full border ${selectedProducts.length === 0 ? "border-sky-600 bg-sky-600 text-white" : "border-slate-300"}`} aria-hidden="true">
                {selectedProducts.length === 0 ? "✓" : ""}
              </span>
              Wszystkie
            </button>
            {filteredProducts.map((product) => (
              <label key={product} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={selectedProducts.includes(product)}
                  onChange={() => onToggle(product)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-sky-600"
                />
                <span>{product}</span>
              </label>
            ))}
            {products.length === 0 ? (
              <p className="px-2 py-2 text-xs text-slate-500">Brak produktów w danych sprzedażowych.</p>
            ) : filteredProducts.length === 0 ? (
              <p className="px-2 py-2 text-xs text-slate-500">Brak produktów pasujących do wyszukiwania.</p>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-3 py-2">
            <span className="text-xs text-slate-500">{hasChanges ? "Niezastosowane zmiany" : "Filtr aktualny"}</span>
            <button
              type="button"
              onClick={() => {
                detailsRef.current?.removeAttribute("open");
                onApply();
              }}
              disabled={!hasChanges || isLoading}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              Zastosuj
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}

function haveSameProducts(left: string[], right: string[]) {
  return left.length === right.length && left.every((product) => right.includes(product));
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

function PromotionCampaignSection({
  campaigns,
  selectedCampaign,
  selectedProduct,
  studioUuid,
  smsTemplates,
  welcomeSmsMessage,
  onSelectProduct,
}: {
  campaigns: PromotionCampaign[];
  selectedCampaign: PromotionCampaign | null;
  selectedProduct: string;
  studioUuid?: string;
  smsTemplates?: SmsTemplate[];
  welcomeSmsMessage?: string;
  onSelectProduct: (product: string) => void;
}) {
  const [sortBy, setSortBy] = useState<{ key: PromotionCampaignSortKey; direction: SortDirection }>({ key: "purchaseDate", direction: "desc" });
  const templates = smsTemplates?.length
    ? smsTemplates
    : [{ id: "welcome", label: "Powitalny", message: welcomeSmsMessage ?? "" }];
  const [selectedTemplateId, setSelectedTemplateId] = useState(templates[0]?.id ?? "welcome");
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? templates[0];

  const sortedCampaignRows = useMemo(() => {
    const rows = selectedCampaign?.rows ?? [];
    return [...rows].sort((left, right) => comparePromotionRows(left, right, sortBy.key, sortBy.direction));
  }, [selectedCampaign, sortBy]);

  const toggleSort = (key: PromotionCampaignSortKey) => {
    setSortBy((current) => ({
      key,
      direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  };

  return (
    <TableCard title="Analiza promocji / karnetu">
      {campaigns.length === 0 || !selectedCampaign ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-muted-foreground">Brak sprzedanych karnetów w danych.</div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
            <label className="grid gap-1 text-xs font-semibold text-slate-700">
              Wybierz karnet/promocję
              <select
                value={selectedProduct}
                onChange={(event) => onSelectProduct(event.target.value)}
                className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              >
                {campaigns.map((campaign) => (
                  <option key={campaign.productName} value={campaign.productName}>
                    {campaign.productName} ({campaign.buyers})
                  </option>
                ))}
              </select>
            </label>
            <div className="rounded-xl border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-800">
              <p className="font-bold">Podsumowanie kampanii</p>
              <p>Retencja: {selectedCampaign.retentionRate.toFixed(1)}% po min. 30 dniach</p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
            <SummaryTile label="Kupujący" value={String(selectedCampaign.buyers)} sublabel={`${selectedCampaign.purchases} zakupów`} />
            <SummaryTile label="Zostali" value={String(selectedCampaign.retained)} sublabel="aktywni w ostatnie 30 dni" valueClass="text-emerald-700" />
            <SummaryTile label="W trakcie" value={String(selectedCampaign.pending)} sublabel="mniej niż 30 dni" valueClass="text-amber-700" />
            <SummaryTile label="Nie stali" value={String(selectedCampaign.inactiveAfterFollowUp)} sublabel="kolejny zakup, potem cisza" valueClass="text-orange-700" />
            <SummaryTile label="Nie zostali" value={String(selectedCampaign.lost)} sublabel="brak zakupu po 30 dniach" valueClass="text-rose-700" />
            <SummaryTile label="Przychód z karnetu" value={money.format(selectedCampaign.campaignRevenue)} sublabel="wybrana promocja" />
            <SummaryTile label="Przychód później" value={money.format(selectedCampaign.followUpRevenue)} sublabel="po zakupie promocji" />
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            <span className="font-bold text-slate-800">Najczęstszy kolejny zakup: </span>
            {selectedCampaign.topNextProducts.length === 0
              ? "brak kolejnych zakupów"
              : selectedCampaign.topNextProducts.map((product) => `${product.name} (${product.count})`).join(", ")}
          </div>

          <label className="grid max-w-sm gap-1 text-xs font-semibold text-slate-700">
            Typ SMS-a z szablonu
            <select
              value={selectedTemplate?.id ?? ""}
              onChange={(event) => setSelectedTemplateId(event.target.value)}
              className="min-h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>{template.label}</option>
              ))}
            </select>
          </label>

          <div className="max-w-full overflow-x-auto">
            <Table className="min-w-[1160px] text-xs">
              <TableHeader>
                <TableRow>
                  <SortablePromotionHead label="Klient" sortKey="name" sortBy={sortBy} onSort={toggleSort} />
                  <SortablePromotionHead label="Zakup promocji" sortKey="purchaseDate" sortBy={sortBy} onSort={toggleSort} />
                  <SortablePromotionHead label="Kwota" sortKey="campaignAmount" sortBy={sortBy} onSort={toggleSort} align="right" />
                  <SortablePromotionHead label="Status" sortKey="status" sortBy={sortBy} onSort={toggleSort} />
                  <SortablePromotionHead label="Dni od ost. zakupu" sortKey="daysSinceLastPurchase" sortBy={sortBy} onSort={toggleSort} align="right" />
                  <SortablePromotionHead label="Kolejny zakup" sortKey="nextProduct" sortBy={sortBy} onSort={toggleSort} />
                  <SortablePromotionHead label="Dni do zakupu" sortKey="daysToNextPurchase" sortBy={sortBy} onSort={toggleSort} align="right" />
                  <SortablePromotionHead label="Co kupił potem" sortKey="followUpProducts" sortBy={sortBy} onSort={toggleSort} />
                  <SortablePromotionHead label="Przychód potem" sortKey="followUpRevenue" sortBy={sortBy} onSort={toggleSort} align="right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedCampaignRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-muted-foreground">Brak klientów dla tej promocji.</TableCell>
                  </TableRow>
                ) : (
                  sortedCampaignRows.map((row) => (
                    <TableRow key={`${row.name}-${row.purchaseDate}`} className={getPromotionStatusRowClass(row)}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <ClientNameLink name={row.name} studioUuid={studioUuid} clientGuid={row.clientGuid} />
                          <SmsLink phone={row.phone} clientName={row.name} />
                          <TemplateSmsLink phone={row.phone} clientName={row.name} template={selectedTemplate} />
                        </div>
                      </TableCell>
                      <TableCell>{new Date(row.purchaseDate).toLocaleDateString("pl-PL")}</TableCell>
                      <TableCell className="text-right">{money.format(row.campaignAmount)}</TableCell>
                      <TableCell>
                        <span className={getPromotionStatusBadgeClass(row)}>
                          {getPromotionStatusLabel(row)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{row.daysSinceLastPurchase}</TableCell>
                      <TableCell>{row.nextProduct ? `${row.nextProduct} (${new Date(row.nextPurchaseDate ?? row.purchaseDate).toLocaleDateString("pl-PL")})` : "-"}</TableCell>
                      <TableCell className="text-right">{row.daysToNextPurchase ?? "-"}</TableCell>
                      <TableCell>{row.followUpProducts.length ? row.followUpProducts.join(", ") : "-"}</TableCell>
                      <TableCell className="text-right">{money.format(row.followUpRevenue)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </TableCard>
  );
}

function RecentPurchasesTable({
  rows,
  studioUuid,
  smsTemplates,
  welcomeSmsMessage,
}: {
  rows: {
    date: string;
    clientName: string;
    clientGuid: string | null;
    phone: string | null;
    product: string;
    amount: number;
    isNewClient: boolean;
  }[];
  studioUuid?: string;
  smsTemplates?: SmsTemplate[];
  welcomeSmsMessage?: string;
}) {
  const templates = smsTemplates?.length
    ? smsTemplates
    : [{ id: "welcome", label: "Powitalny", message: welcomeSmsMessage ?? "" }];
  const [selectedTemplateId, setSelectedTemplateId] = useState(templates[0]?.id ?? "welcome");
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? templates[0];

  return (
    <div className="space-y-3">
      <label className="grid max-w-sm gap-1 text-xs font-semibold text-slate-700">
        Typ SMS-a z szablonu
        <select
          value={selectedTemplate?.id ?? ""}
          onChange={(event) => setSelectedTemplateId(event.target.value)}
          className="min-h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
        >
          {templates.map((template) => (
            <option key={template.id} value={template.id}>{template.label}</option>
          ))}
        </select>
      </label>

      <div className="max-w-full overflow-x-auto">
      <Table className="min-w-[860px] text-xs">
        <TableHeader>
          <TableRow>
            <TableHead>Klient</TableHead>
            <TableHead>Nowy klient</TableHead>
            <TableHead>Co kupił</TableHead>
            <TableHead>Data</TableHead>
            <TableHead className="text-right">Kwota</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground">
                Brak zakupów.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={`${row.clientName}-${row.date}-${row.product}`} className={row.isNewClient ? "bg-emerald-50/70" : ""}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <ClientNameLink name={row.clientName} studioUuid={studioUuid} clientGuid={row.clientGuid} />
                    <SmsLink phone={row.phone} clientName={row.clientName} />
                    <TemplateSmsLink phone={row.phone} clientName={row.clientName} template={selectedTemplate} />
                  </div>
                </TableCell>
                <TableCell>
                  {row.isNewClient ? (
                    <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">Tak</span>
                  ) : (
                    <span className="text-slate-400">Nie</span>
                  )}
                </TableCell>
                <TableCell>{row.product}</TableCell>
                <TableCell>{new Date(row.date).toLocaleDateString("pl-PL")}</TableCell>
                <TableCell className="text-right">{money.format(row.amount)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}

function SortablePromotionHead({
  label,
  sortKey,
  sortBy,
  onSort,
  align,
}: {
  label: string;
  sortKey: PromotionCampaignSortKey;
  sortBy: { key: PromotionCampaignSortKey; direction: SortDirection };
  onSort: (key: PromotionCampaignSortKey) => void;
  align?: "right";
}) {
  const active = sortBy.key === sortKey;
  return (
    <TableHead
      className={`${active ? "bg-sky-50 text-sky-900" : "text-slate-600"} ${align === "right" ? "text-right" : ""}`}
      aria-sort={active ? (sortBy.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`group inline-flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-xs font-semibold transition-colors hover:bg-slate-100 ${align === "right" ? "justify-end" : "justify-start"}`}
      >
        <span>{label}</span>
        <span
          className={`relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
            active ? "border-sky-200 bg-sky-100" : "border-transparent bg-transparent opacity-0 group-hover:opacity-60"
          }`}
          aria-hidden="true"
        >
          <span
            className={`block h-1.5 w-1.5 border-r-2 border-b-2 ${active ? "border-sky-700" : "border-slate-400"} ${
              active && sortBy.direction === "asc" ? "rotate-[225deg] translate-y-0.5" : "rotate-45 -translate-y-0.5"
            }`}
          />
        </span>
      </button>
    </TableHead>
  );
}

function comparePromotionRows(
  left: PromotionCampaign["rows"][number],
  right: PromotionCampaign["rows"][number],
  key: PromotionCampaignSortKey,
  direction: SortDirection,
) {
  const getValue = (row: PromotionCampaign["rows"][number]): string | number => {
    if (key === "name") return row.name;
    if (key === "purchaseDate") return new Date(row.purchaseDate).getTime();
    if (key === "campaignAmount") return row.campaignAmount;
    if (key === "status") return getPromotionStatusLabel(row);
    if (key === "daysSinceLastPurchase") return row.daysSinceLastPurchase;
    if (key === "nextProduct") return row.nextProduct ?? "";
    if (key === "daysToNextPurchase") return row.daysToNextPurchase ?? Number.POSITIVE_INFINITY;
    if (key === "followUpProducts") return row.followUpProducts.join(", ");
    return row.followUpRevenue;
  };

  const leftValue = getValue(left);
  const rightValue = getValue(right);
  const result = typeof leftValue === "number" && typeof rightValue === "number"
    ? leftValue - rightValue
    : String(leftValue).localeCompare(String(rightValue), "pl", { sensitivity: "base" });
  return direction === "asc" ? result : -result;
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

function SmsLink({ phone, clientName }: { phone: string | null | undefined; clientName: string }) {
  const normalized = String(phone ?? "").replace(/[^\d+]/g, "");
  if (!normalized) {
    return (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-300" title="Brak telefonu">
        <MessageCircle className="h-3.5 w-3.5" />
      </span>
    );
  }
  const href = buildSmsHref(normalized);

  return (
    <a
      href={href}
      onClick={(event) => openSmsHref(event, href)}
      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
      aria-label={`Wyślij SMS do ${clientName}`}
      title={`Wyślij SMS do ${clientName}`}
    >
      <MessageCircle className="h-3.5 w-3.5" />
    </a>
  );
}

function TemplateSmsLink({ phone, clientName, template }: { phone: string | null | undefined; clientName: string; template?: SmsTemplate }) {
  const normalized = String(phone ?? "").replace(/[^\d+]/g, "");
  const firstName = clientName.trim().split(/\s+/)[0] || "";
  const fallbackMessage = `Cześć${firstName ? ` ${firstName}` : ""}, tu Reforma Pilates. Dziękujemy za zakup i witamy w studiu! Jeśli masz pytania albo chcesz dobrać termin zajęć, odpisz na tę wiadomość.`;
  const message = template?.message?.trim()
    ? template.message.replaceAll("{imie}", firstName).replaceAll("{imię}", firstName)
    : fallbackMessage;
  const label = template?.label ?? "SMS z szablonu";

  if (!normalized) {
    return (
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-300" title="Brak telefonu">
        <PartyPopper className="h-3.5 w-3.5" />
      </span>
    );
  }
  const href = buildSmsHref(normalized, message);

  return (
    <a
      href={href}
      onClick={(event) => openSmsHref(event, href)}
      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
      aria-label={`Wyślij ${label} do ${clientName}`}
      title={`${label} do ${clientName}`}
    >
      <PartyPopper className="h-3.5 w-3.5" />
    </a>
  );
}

function buildSmsHref(phone: string, body?: string) {
  if (!body) return `sms:${phone}`;
  const separator = isAppleSmsDevice() ? "&" : "?";
  return `sms:${phone}${separator}body=${encodeURIComponent(body)}`;
}

function isAppleSmsDevice() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function openSmsHref(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
  event.preventDefault();
  window.location.href = href;
}

function getPromotionStatusLabel(row: { retained: boolean; pending: boolean; inactiveAfterFollowUp: boolean }) {
  if (row.retained) return "został";
  if (row.pending) return "w trakcie";
  if (row.inactiveAfterFollowUp) return "nie stały";
  return "nie został";
}

function getPromotionStatusBadgeClass(row: { retained: boolean; pending: boolean; inactiveAfterFollowUp: boolean }) {
  if (row.retained) return "inline-flex rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700";
  if (row.pending) return "inline-flex rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700";
  if (row.inactiveAfterFollowUp) return "inline-flex rounded-full bg-orange-100 px-2 py-0.5 font-semibold text-orange-700";
  return "inline-flex rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700";
}

function getPromotionStatusRowClass(row: { retained: boolean; pending: boolean; inactiveAfterFollowUp: boolean }) {
  if (row.retained) return "bg-emerald-50/40";
  if (row.pending) return "bg-amber-50/40";
  if (row.inactiveAfterFollowUp) return "bg-orange-50/40";
  return "bg-rose-50/40";
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
