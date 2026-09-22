"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Search } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { getHistoryLeadStage, getLeadId, LEAD_STAGE_OPTIONS, LEAD_STAGE_STORAGE_KEY, type LeadStage, type LeadStageSource } from "@/lib/lead-stage";
import { buildGroupSmsHref, normalizeSmsPhone, prepareSalesSms } from "@/lib/sales-sms";

type Purchase = { product: string; amount: number; date: string; isPass: boolean };
type Client = {
  key: string;
  name: string;
  clientGuid: string | null;
  phone: string | null;
  lifetimeRevenue: number;
  purchaseCount: number;
  passCount: number;
  lastPurchaseDate: string;
  months: Record<string, Purchase[]>;
};
type SmsTemplate = { id: string; label: string; message: string };
type Payload = { clients?: Client[]; smsTemplates?: SmsTemplate[]; error?: string };
type DashboardLeadsPayload = { contacts?: ({ name: string; clientGuid: string | null } & LeadStageSource)[] };
type SortKey = "name" | "ltv" | "purchases" | "passes" | "recent" | "gap";

const money = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 });
const monthLabel = new Intl.DateTimeFormat("pl-PL", { month: "short", year: "2-digit", timeZone: "UTC" });
const dateLabel = new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short", year: "numeric" });
const nowParts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit" }).formatToParts(new Date());
const nowMonth = `${nowParts.find((part) => part.type === "year")?.value}-${nowParts.find((part) => part.type === "month")?.value}`;

function monthNumber(month: string) {
  const [year, part] = month.split("-").map(Number);
  return year * 12 + part - 1;
}

function fromMonthNumber(value: number) {
  return `${Math.floor(value / 12)}-${String(value % 12 + 1).padStart(2, "0")}`;
}

function readableMonth(month: string) {
  return monthLabel.format(new Date(`${month}-01T12:00:00Z`));
}

function lastPassMonth(client: Client) {
  return Object.keys(client.months).filter((month) => client.months[month].some((purchase) => purchase.isPass)).sort().at(-1) ?? null;
}

function passCellValue(product: string) {
  const bonusEntries = product.match(/(\d+)\s*\+\s*(\d+)/);
  if (bonusEntries) return `${bonusEntries[1]}+${bonusEntries[2]}`;
  const entries = product.match(/(\d+)\s*wej/i);
  if (entries) return entries[1];
  if (/open|bez limitu|nielimit/i.test(product)) return "∞";
  return "🎟";
}

export default function ClientHistoryPage() {
  const [data, setData] = useState<Client[]>([]);
  const [smsTemplates, setSmsTemplates] = useState<SmsTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<12 | 24 | "all">(12);
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "ltv", direction: "desc" });
  const [onlyPasses, setOnlyPasses] = useState(false);
  const [selectedClientKeys, setSelectedClientKeys] = useState<string[]>([]);
  const selectionAnchor = useRef<string | null>(null);
  const [smsAudience, setSmsAudience] = useState<"selected" | "all">("selected");
  const [selectedSmsTemplateId, setSelectedSmsTemplateId] = useState("");
  const [stages, setStages] = useState<Record<string, LeadStage>>({});
  const [leadSources, setLeadSources] = useState<Record<string, LeadStageSource>>({});
  const [stagesLoaded, setStagesLoaded] = useState(false);
  const [selected, setSelected] = useState<{ client: Client; month: string } | null>(null);

  const load = useCallback(async () => {
    setError("");
    const dashboardPromise = fetch("/api/fitssey/dashboard")
      .then(async (response) => response.ok ? (await response.json()) as DashboardLeadsPayload : null)
      .catch(() => null);
    try {
      const response = await fetch("/api/fitssey/client-history");
      const payload = (await response.json()) as Payload;
      if (!response.ok) throw new Error(payload.error || "Nie udało się pobrać historii klientów.");
      setData(payload.clients ?? []);
      setSmsTemplates(payload.smsTemplates ?? []);
      void dashboardPromise.then((dashboard) => {
        if (!dashboard) return;
        const sources: Record<string, LeadStageSource> = {};
        for (const lead of dashboard.contacts ?? []) {
          const source = { priority: lead.priority, activeEntries: lead.activeEntries };
          sources[getLeadId(lead)] = source;
          sources[getLeadId({ name: lead.name, clientGuid: null })] = source;
        }
        setLeadSources(sources);
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nie udało się pobrać historii klientów.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener("fitssey:auto-import-completed", load);
    return () => window.removeEventListener("fitssey:auto-import-completed", load);
  }, [load]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LEAD_STAGE_STORAGE_KEY);
      if (raw) setStages(JSON.parse(raw) as Record<string, LeadStage>);
    } catch {
      setStages({});
    }
    setStagesLoaded(true);
  }, []);

  useEffect(() => {
    if (stagesLoaded) window.localStorage.setItem(LEAD_STAGE_STORAGE_KEY, JSON.stringify(stages));
  }, [stages, stagesLoaded]);

  const products = useMemo(() => [...new Set(data.flatMap((client) => Object.values(client.months)
    .flat().filter((purchase) => purchase.isPass).map((purchase) => purchase.product)))].sort((a, b) => a.localeCompare(b, "pl")), [data]);
  const productIndex = useMemo(() => new Map(products.map((product, index) => [product, index])), [products]);
  const ltvStarThreshold = useMemo(() => data.length > 1
    ? [...data.map((client) => client.lifetimeRevenue)].sort((a, b) => b - a)[Math.floor(data.length * 0.1)]
    : Number.POSITIVE_INFINITY, [data]);
  const hue = (product: string) => (productIndex.get(product) ?? 0) * 137.5 % 360;

  const months = useMemo(() => {
    const first = data.flatMap((client) => Object.keys(client.months)).sort()[0];
    if (!first) return [];
    const end = Math.max(monthNumber(nowMonth), ...data.flatMap((client) => Object.keys(client.months).map(monthNumber)));
    const start = range === "all" ? monthNumber(first) : Math.max(monthNumber(first), end - range + 1);
    return Array.from({ length: end - start + 1 }, (_, index) => fromMonthNumber(start + index));
  }, [data, range]);

  const visible = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("pl");
    const filtered = data.filter((client) => (!search || client.name.toLocaleLowerCase("pl").includes(search)) && (!onlyPasses || client.passCount > 0));
    return filtered.sort((a, b) => {
      const gap = (client: Client) => {
        const last = lastPassMonth(client);
        return last ? monthNumber(nowMonth) - monthNumber(last) : null;
      };
      if (sort.key === "gap" && (gap(a) === null || gap(b) === null)) {
        if (gap(a) === null && gap(b) !== null) return 1;
        if (gap(b) === null && gap(a) !== null) return -1;
      }
      let result = 0;
      if (sort.key === "name") result = a.name.localeCompare(b.name, "pl");
      if (sort.key === "ltv") result = a.lifetimeRevenue - b.lifetimeRevenue;
      if (sort.key === "purchases") result = a.purchaseCount - b.purchaseCount;
      if (sort.key === "passes") result = a.passCount - b.passCount;
      if (sort.key === "recent") result = a.lastPurchaseDate.localeCompare(b.lastPurchaseDate);
      if (sort.key === "gap") result = (gap(a) ?? 0) - (gap(b) ?? 0);
      return (sort.direction === "asc" ? result : -result) || a.name.localeCompare(b.name, "pl");
    });
  }, [data, query, onlyPasses, sort]);

  const selectableKeys = useMemo(() => visible.filter((client) => Boolean(normalizeSmsPhone(client.phone))).map((client) => client.key), [visible]);
  const allVisibleSelected = selectableKeys.length > 0 && selectableKeys.every((key) => selectedClientKeys.includes(key));
  const selectedClients = visible.filter((client) => selectedClientKeys.includes(client.key) && Boolean(normalizeSmsPhone(client.phone)));
  const smsRecipients = smsAudience === "all" ? data : selectedClients;
  const selectedSmsTemplate = smsTemplates.find((template) => template.id === selectedSmsTemplateId) ?? smsTemplates[0];
  const groupSms = prepareSalesSms(smsRecipients, selectedSmsTemplate?.message ?? "");

  useEffect(() => {
    const visibleKeys = new Set(selectableKeys);
    setSelectedClientKeys((previous) => {
      const next = previous.filter((key) => visibleKeys.has(key));
      return next.length === previous.length ? previous : next;
    });
  }, [selectableKeys]);

  const toggleClientSelection = (key: string, checked: boolean, shiftKey = false) => {
    const anchorIndex = visible.findIndex((client) => client.key === selectionAnchor.current);
    const targetIndex = visible.findIndex((client) => client.key === key);
    const rangeKeys = shiftKey && anchorIndex >= 0 && targetIndex >= 0
      ? visible.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1)
        .filter((client) => Boolean(normalizeSmsPhone(client.phone)))
        .map((client) => client.key)
      : [key];
    setSelectedClientKeys((previous) => checked
      ? [...new Set([...previous, ...rangeKeys])]
      : previous.filter((item) => !rangeKeys.includes(item)));
    if (!shiftKey || anchorIndex < 0) selectionAnchor.current = key;
  };
  const toggleVisibleSelection = () => {
    setSelectedClientKeys(allVisibleSelected ? [] : selectableKeys);
    selectionAnchor.current = allVisibleSelected ? null : selectableKeys[0] ?? null;
  };
  const openGroupSms = () => {
    if (groupSms.phones.length && groupSms.message) {
      window.location.href = buildGroupSmsHref(groupSms.phones, groupSms.message, navigator.userAgent);
    }
  };

  const setSortKey = (key: SortKey) => setSort((previous) => ({
    key,
    direction: previous.key === key && previous.direction === "desc" ? "asc" : "desc",
  }));
  const sortMark = (key: SortKey) => sort.key === key
    ? sort.direction === "desc" ? <ArrowDown size={13} /> : <ArrowUp size={13} />
    : null;
  const selectedPurchases = selected?.client.months[selected.month] ?? [];

  return (
    <AppShell title="Historia klientów">
      <section className="rounded-lg border bg-white px-3 py-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-52 flex-1 sm:max-w-72">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <span className="sr-only">Szukaj klienta</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj klienta" className="h-9 w-full rounded-md border bg-white pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
          </label>
          <div className="inline-flex rounded-md border bg-slate-50 p-0.5" aria-label="Zakres miesięcy">
            {([12, 24, "all"] as const).map((value) => <button key={value} type="button" onClick={() => setRange(value)} className={`rounded px-3 py-1.5 text-sm ${range === value ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-200"}`}>{value === "all" ? "Całość" : `${value} mies.`}</button>)}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={onlyPasses} onChange={(event) => setOnlyPasses(event.target.checked)} className="h-4 w-4 accent-blue-600" />Tylko kupujący karnety</label>
          <span className="ml-auto text-xs text-slate-600">{visible.length} klientów · Shift: zakres · Ctrl/⌘: pojedynczo</span>
        </div>
        <details className="mt-1 text-xs text-slate-600"><summary className="cursor-pointer font-medium text-slate-700">Legenda kolorów i oznaczeń</summary><div className="mt-2 flex flex-wrap gap-x-4 gap-y-2"><span>Kolor: typ karnetu · liczba: wejścia · blednięcie: czas od zakupu · •: inny zakup</span><span>🔥 karnet w tym miesiącu · ⭐ wysokie LTV · 💤 długa przerwa</span></div><div className="mt-2 flex flex-wrap gap-2">{products.map((product) => <span key={product} className="inline-flex items-center gap-1.5 rounded-md border bg-white px-2 py-1"><span className="h-4 w-4 rounded-sm" style={{ backgroundColor: `hsl(${hue(product)} 65% 48%)` }} />{product}</span>)}</div></details>
      </section>

      <details className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 shadow-sm">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">Wysyłka grupowa SMS · zaznaczeni: {selectedClients.length} · odbiorcy: {groupSms.phones.length}</summary>
        <div className="mt-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">Wysyłka grupowa SMS</h2>
            <p className="mt-1 text-xs text-slate-600">Odbiorcy z poprawnym numerem: <strong>{groupSms.phones.length}</strong>. Przy wielu odbiorcach szablon pomija imię.</p>
          </div>
          <div className="inline-flex rounded-md border bg-white p-0.5 text-xs">
            <button type="button" onClick={() => setSmsAudience("selected")} aria-pressed={smsAudience === "selected"} className={`rounded px-3 py-1.5 ${smsAudience === "selected" ? "bg-sky-700 text-white" : "text-slate-700"}`}>Zaznaczeni ({selectedClients.length})</button>
            <button type="button" onClick={() => setSmsAudience("all")} aria-pressed={smsAudience === "all"} className={`rounded px-3 py-1.5 ${smsAudience === "all" ? "bg-sky-700 text-white" : "text-slate-700"}`}>Wszyscy ({data.length})</button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="grid min-w-48 flex-1 gap-1 text-xs font-medium text-slate-700 sm:max-w-72">Typ SMS-a
            <select value={selectedSmsTemplate?.id ?? ""} onChange={(event) => setSelectedSmsTemplateId(event.target.value)} disabled={smsTemplates.length === 0} className="h-9 rounded-md border bg-white px-2 text-sm font-normal disabled:bg-slate-100">
              {smsTemplates.length === 0 ? <option value="">Brak szablonów SMS</option> : smsTemplates.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
            </select>
          </label>
          <button type="button" onClick={openGroupSms} disabled={groupSms.phones.length === 0 || !groupSms.message} className="h-9 rounded-md bg-sky-700 px-3 text-sm font-semibold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50">Wyślij SMS ({groupSms.phones.length})</button>
          <button type="button" onClick={() => { setSelectedClientKeys([]); selectionAnchor.current = null; }} disabled={selectedClientKeys.length === 0} className="h-9 rounded-md border bg-white px-3 text-sm hover:bg-slate-50 disabled:opacity-50">Wyczyść zaznaczenie</button>
        </div>
        {selectedSmsTemplate && <p className="mt-3 whitespace-pre-wrap text-xs text-slate-600">Treść: {groupSms.message}</p>}
        <p className="mt-3 border-t border-sky-200 pt-2 text-[11px] text-slate-500">Przycisk otwiera aplikację Wiadomości — tam zatwierdzisz wysłanie. Numery brakujące i niepoprawne są pomijane, a powtarzające się numery dodawane tylko raz. „Wszyscy” obejmuje całą historię niezależnie od filtrów. Sposób wysyłki zależy od aplikacji Wiadomości; odbiorcy mogą widzieć pozostałe numery.</p>
        </div>
      </details>

      {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error} <button type="button" onClick={() => void load()} className="ml-2 font-semibold underline">Spróbuj ponownie</button></div>}
      <section className="overflow-hidden rounded-lg border bg-white shadow-sm">
        {loading ? <p className="p-6 text-sm text-slate-600">Ładowanie historii zakupów…</p> : visible.length === 0 ? <p className="p-6 text-sm text-slate-600">Brak klientów pasujących do filtrów.</p> : <div className="h-[calc(100dvh-245px)] min-h-72 overflow-auto">
          <table className="border-separate border-spacing-0 text-xs" aria-label="Historia zakupów klientów">
            <thead className="sticky top-0 z-20 bg-slate-100 text-slate-700"><tr>
              <th scope="col" className="sticky left-0 z-30 w-10 min-w-10 border-b border-r bg-slate-100 px-2 py-2 text-center"><input type="checkbox" aria-label="Zaznacz widocznych klientów z numerem telefonu" checked={allVisibleSelected} onChange={toggleVisibleSelection} disabled={selectableKeys.length === 0} className="h-4 w-4 accent-sky-700" /></th>
              <th scope="col" className="sticky left-10 z-30 min-w-52 border-b border-r bg-slate-100 px-3 py-2 text-left"><button type="button" onClick={() => setSortKey("name")} className="inline-flex items-center gap-1 font-semibold">Klient {sortMark("name")}</button></th>
              <th scope="col" className="min-w-36 border-b border-r px-2 py-2 text-left font-semibold">Status leada</th>
              <th scope="col" className="min-w-24 border-b border-r px-2 py-2 text-right"><button type="button" onClick={() => setSortKey("ltv")} className="inline-flex items-center gap-1 font-semibold">LTV {sortMark("ltv")}</button></th>
              <th scope="col" className="min-w-16 border-b border-r px-2 py-2 text-right"><button type="button" onClick={() => setSortKey("purchases")} className="inline-flex items-center gap-1 font-semibold">Zakupy {sortMark("purchases")}</button></th>
              <th scope="col" className="min-w-16 border-b border-r px-2 py-2 text-right"><button type="button" onClick={() => setSortKey("passes")} className="inline-flex items-center gap-1 font-semibold">Karnety {sortMark("passes")}</button></th>
              <th scope="col" className="min-w-24 border-b border-r px-2 py-2 text-right"><button type="button" onClick={() => setSortKey("recent")} className="inline-flex items-center gap-1 font-semibold">Ostatni zakup {sortMark("recent")}</button></th>
              <th scope="col" className="min-w-16 border-b border-r px-2 py-2 text-right"><button type="button" onClick={() => setSortKey("gap")} className="inline-flex items-center gap-1 font-semibold">Przerwa {sortMark("gap")}</button></th>
              {months.map((month) => <th key={month} scope="col" className={`min-w-16 border-b border-r px-2 py-2 text-center font-semibold ${month === nowMonth ? "bg-blue-50 text-blue-800" : ""}`}>{readableMonth(month)}</th>)}
            </tr></thead>
            <tbody>{visible.map((client) => {
              const lastPass = lastPassMonth(client);
              const gap = lastPass ? Math.max(0, monthNumber(nowMonth) - monthNumber(lastPass)) : null;
              const topLtv = client.lifetimeRevenue >= ltvStarThreshold;
              const leadSource = leadSources[getLeadId(client)] ?? leadSources[getLeadId({ name: client.name, clientGuid: null })];
              const previousPassMonth = Object.keys(client.months).filter((month) => month < months[0] && client.months[month].some((purchase) => purchase.isPass)).sort().at(-1);
              let precedingPassMonth = previousPassMonth ?? null;
              let precedingPass = previousPassMonth ? client.months[previousPassMonth].filter((purchase) => purchase.isPass).at(-1)!.product : null;
              return <tr key={client.key} onClick={(event) => {
                if ((!event.shiftKey && !event.ctrlKey && !event.metaKey) || !normalizeSmsPhone(client.phone)) return;
                if ((event.target as HTMLElement).closest("input, select, button, a")) return;
                event.preventDefault();
                toggleClientSelection(client.key, !selectedClientKeys.includes(client.key), event.shiftKey);
              }} className={`hover:bg-slate-50 ${selectedClientKeys.includes(client.key) ? "bg-sky-50" : ""}`}>
                <td className="sticky left-0 z-10 border-b border-r bg-white px-2 py-2 text-center"><input type="checkbox" aria-label={`Zaznacz ${client.name} do SMS-a`} checked={selectedClientKeys.includes(client.key)} onChange={(event) => toggleClientSelection(client.key, event.target.checked, Boolean((event.nativeEvent as MouseEvent).shiftKey))} disabled={!normalizeSmsPhone(client.phone)} title={normalizeSmsPhone(client.phone) ? undefined : "Brak poprawnego numeru telefonu"} className="h-4 w-4 accent-sky-700 disabled:cursor-not-allowed" /></td>
                <th scope="row" className="sticky left-10 z-10 max-w-52 truncate border-b border-r bg-white px-3 py-2 text-left font-medium text-slate-900" title={client.name}>{client.name} {gap === 0 ? "🔥" : gap !== null && gap >= 3 ? "💤" : ""} {topLtv ? "⭐" : ""}</th>
                <td className="border-b border-r px-1 py-1"><select aria-label={`Status leada: ${client.name}`} value={getHistoryLeadStage(stages, client, leadSource)} onChange={(event) => setStages((previous) => {
                  const next = { ...previous };
                  if (event.target.value) next[getLeadId(client)] = event.target.value as LeadStage;
                  else delete next[getLeadId(client)];
                  return next;
                })} className="h-7 w-full rounded border bg-white px-1 text-xs">{!leadSource && <option value="">Bez statusu</option>}{LEAD_STAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></td>
                <td className="border-b border-r px-2 py-2 text-right tabular-nums">{money.format(client.lifetimeRevenue)} zł</td>
                <td className="border-b border-r px-2 py-2 text-right tabular-nums">{client.purchaseCount}</td>
                <td className="border-b border-r px-2 py-2 text-right tabular-nums">{client.passCount}</td>
                <td className="border-b border-r px-2 py-2 text-right tabular-nums">{dateLabel.format(new Date(client.lastPurchaseDate))}</td>
                <td className="border-b border-r px-2 py-2 text-right tabular-nums">{gap === null ? "—" : `${gap} mies.`}</td>
                {months.map((month) => {
                  const purchases = client.months[month] ?? [];
                  const passes = purchases.filter((purchase) => purchase.isPass);
                  if (passes.length > 0) {
                    precedingPass = passes.at(-1)!.product;
                    precedingPassMonth = month;
                  }
                  const age = precedingPassMonth ? monthNumber(month) - monthNumber(precedingPassMonth) : null;
                  const isPurchase = passes.length > 0;
                  const color = precedingPass ? hue(precedingPass) : 0;
                  const distinctPasses = [...new Set(passes.map((purchase) => purchase.product))];
                  const background = distinctPasses.length > 1
                    ? `linear-gradient(90deg, ${distinctPasses.map((product, index) => `hsl(${hue(product)} 65% 47%) ${index * 100 / distinctPasses.length}% ${(index + 1) * 100 / distinctPasses.length}%`).join(", ")})`
                    : isPurchase ? `hsl(${color} 65% 47%)` : age !== null ? `hsl(${color} 65% ${Math.min(96, 80 + age * 4)}%)` : "transparent";
                  const label = isPurchase
                    ? passes.length > 1 ? `🎟×${passes.length}` : passCellValue(passes[0].product)
                    : purchases.length > 0 ? "•" : "";
                  const tooltip = `${client.name}, ${readableMonth(month)}: ${purchases.length ? purchases.map((purchase) => `${purchase.product} (${money.format(purchase.amount)} zł)`).join(", ") : age !== null ? `${age} mies. od ostatniego karnetu` : "brak zakupu"}`;
                  return <td key={month} className="border-b border-r p-0.5 text-center"><button type="button" onClick={() => setSelected({ client, month })} title={tooltip} aria-label={tooltip} className={`h-8 w-full min-w-14 rounded-sm font-semibold transition hover:ring-2 hover:ring-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600 ${isPurchase ? "text-white" : purchases.length > 0 ? "text-slate-700" : "text-slate-500"}`} style={{ background }}>{label}</button></td>;
                })}
              </tr>;
            })}</tbody>
          </table>
        </div>}
      </section>

      {selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={() => setSelected(null)}><div role="dialog" aria-modal="true" aria-label="Szczegóły miesiąca" className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">{selected.client.name}</h2><p className="text-sm text-slate-600">{readableMonth(selected.month)}</p></div><button type="button" onClick={() => setSelected(null)} className="rounded-md border px-2 py-1 text-sm">Zamknij</button></div>
        {selectedPurchases.length ? <ul className="mt-4 divide-y">{selectedPurchases.map((purchase, index) => <li key={`${purchase.date}-${index}`} className="flex justify-between gap-4 py-2 text-sm"><div><span className="font-medium">{purchase.product}</span><p className="text-xs text-slate-500">{purchase.isPass ? "Karnet" : "Inny zakup"} · {dateLabel.format(new Date(purchase.date))}</p></div><span className="shrink-0 tabular-nums">{money.format(purchase.amount)} zł</span></li>)}</ul> : <p className="mt-4 text-sm text-slate-600">Brak zakupów w tym miesiącu.</p>}
      </div></div>}
    </AppShell>
  );
}
