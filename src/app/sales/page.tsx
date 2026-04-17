"use client";

import { useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type LeadPriority = "wysoki" | "sredni" | "niski";
type LeadStage = "new" | "contacted" | "offer" | "won" | "lost";
type LeadSegment = "single_to_pass" | "pass_renewal" | "inactive";
type LeadSortKey = "name" | "segment" | "reason" | "priority" | "stage" | "lastPurchaseDate" | "daysSinceLastPurchase" | "activeEntries" | "email" | "phone" | "lifetimeRevenue";
type SortDirection = "asc" | "desc";

type SalesPayload = {
  studioUuid?: string;
  contacts: {
    name: string;
    clientGuid: string | null;
    lastPurchaseDate: string;
    daysSinceLastPurchase: number;
    lastPassPurchaseDate?: string | null;
    daysSinceLastPass?: number | null;
    activeEntries?: number | null;
    lifetimeRevenue: number;
    email: string | null;
    phone: string | null;
    reason: string;
    score: number;
    priority: LeadPriority;
  }[];
  error?: string;
};

const money = new Intl.NumberFormat("pl-PL", { style: "decimal", maximumFractionDigits: 0 });
const LEAD_STAGE_OPTIONS: { value: LeadStage; label: string }[] = [
  { value: "new", label: "Do kontaktu" },
  { value: "contacted", label: "Po 1. kontakcie" },
  { value: "offer", label: "Oferta karnetu" },
  { value: "won", label: "Konwersja" },
  { value: "lost", label: "Brak decyzji" },
];

function getLeadId(lead: SalesPayload["contacts"][number]) {
  return lead.clientGuid ?? `name:${lead.name.toLowerCase().trim()}`;
}

function defaultStage(priority: LeadPriority, activeEntries?: number | null): LeadStage {
  if (activeEntries !== null && activeEntries !== undefined && activeEntries > 1) return "contacted";
  if (activeEntries === 1) return "offer";
  if (priority === "wysoki") return "new";
  if (priority === "sredni") return "contacted";
  return "offer";
}

function getLeadSegment(reason: string): LeadSegment {
  const normalized = reason.toLowerCase();
  if (normalized.includes("jednoraz")) return "single_to_pass";
  if (normalized.includes("karnet")) return "pass_renewal";
  return "inactive";
}

function getLeadSegmentLabel(segment: LeadSegment) {
  if (segment === "single_to_pass") return "Po wejściu pojedynczym";
  if (segment === "pass_renewal") return "Nieprzedłużony karnet";
  return "Brak aktywności";
}

function getSuggestedAction(segment: LeadSegment, activeEntries?: number | null) {
  if (activeEntries !== null && activeEntries !== undefined && activeEntries > 1) {
    return "Klient ma aktywne wejścia - najpierw zaproponuj wykorzystanie grafiku i dopiero potem odnowienie.";
  }
  if (activeEntries === 1) {
    return "Ma ostatnie wejście: zaproponuj odnowienie karnetu od razu po najbliższej wizycie.";
  }
  if (segment === "single_to_pass") return "Zaproponuj karnet startowy + rezerwację stałej godziny.";
  if (segment === "pass_renewal") return "Przypomnij o odnowieniu i podkreśl miejsce w grafiku.";
  return "Krótki follow-up: zaproś na powrót i zaproponuj pojedyncze wejście.";
}

export default function SalesPage() {
  const [data, setData] = useState<SalesPayload | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<"all" | LeadPriority>("all");
  const [reasonFilter, setReasonFilter] = useState<"all" | "single" | "pass" | "inactive">("all");
  const [stages, setStages] = useState<Record<string, LeadStage>>({});
  const [sortBy, setSortBy] = useState<{ key: LeadSortKey; direction: SortDirection } | null>(null);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError("");
      try {
        const response = await fetch("/api/fitssey/dashboard");
        const payload = (await response.json().catch(() => ({}))) as SalesPayload;
        if (!response.ok) {
          setError(payload.error ?? "Nie udało się pobrać leadów sprzedażowych.");
          return;
        }
        setData(payload);
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem("sales_lead_stages_v1");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Record<string, LeadStage>;
      setStages(parsed);
    } catch {
      setStages({});
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("sales_lead_stages_v1", JSON.stringify(stages));
  }, [stages]);

  const reasonOptions = useMemo(() => {
    const leads = data?.contacts ?? [];
    const counts = {
      single: leads.filter((lead) => getLeadSegment(lead.reason) === "single_to_pass").length,
      pass: leads.filter((lead) => getLeadSegment(lead.reason) === "pass_renewal").length,
      inactive: leads.filter((lead) => getLeadSegment(lead.reason) === "inactive").length,
    };
    return counts;
  }, [data]);

  const filteredLeads = useMemo(() => {
    const leads = data?.contacts ?? [];
    return leads.filter((lead) => {
      if (priorityFilter !== "all" && lead.priority !== priorityFilter) return false;
      const segment = getLeadSegment(lead.reason);
      if (reasonFilter === "single" && segment !== "single_to_pass") return false;
      if (reasonFilter === "pass" && segment !== "pass_renewal") return false;
      if (reasonFilter === "inactive" && segment !== "inactive") return false;
      if (query.trim()) {
        const text = `${lead.name} ${lead.reason} ${lead.email ?? ""} ${lead.phone ?? ""}`.toLowerCase();
        if (!text.includes(query.toLowerCase().trim())) return false;
      }
      return true;
    });
  }, [data, priorityFilter, reasonFilter, query]);

  const stageBuckets = useMemo(() => {
    const buckets: Record<LeadStage, SalesPayload["contacts"]> = {
      new: [],
      contacted: [],
      offer: [],
      won: [],
      lost: [],
    };
    for (const lead of filteredLeads) {
      const id = getLeadId(lead);
      const stage = stages[id] ?? defaultStage(lead.priority, lead.activeEntries);
      buckets[stage].push(lead);
    }
    return buckets;
  }, [filteredLeads, stages]);

  const summary = useMemo(() => {
    if (!filteredLeads.length) {
      return { leads: 0, urgent: 0, ltv: 0, avgDays: 0, singleToPass: 0, passRenewal: 0 };
    }
    const urgent = filteredLeads.filter((lead) => lead.priority === "wysoki").length;
    const ltv = filteredLeads.reduce((sum, lead) => sum + lead.lifetimeRevenue, 0);
    const avgDays = Math.round(filteredLeads.reduce((sum, lead) => sum + lead.daysSinceLastPurchase, 0) / filteredLeads.length);
    const singleToPass = filteredLeads.filter((lead) => getLeadSegment(lead.reason) === "single_to_pass").length;
    const passRenewal = filteredLeads.filter((lead) => getLeadSegment(lead.reason) === "pass_renewal").length;
    return { leads: filteredLeads.length, urgent, ltv, avgDays, singleToPass, passRenewal };
  }, [filteredLeads]);

  const sortedLeads = useMemo(() => {
    if (!sortBy) return filteredLeads;

    const stageOrder: Record<LeadStage, number> = {
      new: 0,
      contacted: 1,
      offer: 2,
      won: 3,
      lost: 4,
    };
    const priorityOrder: Record<LeadPriority, number> = {
      wysoki: 0,
      sredni: 1,
      niski: 2,
    };

    const compareText = (left: string, right: string) => left.localeCompare(right, "pl", { sensitivity: "base" });
    const compareNumber = (left: number, right: number) => left - right;

    const getValue = (lead: SalesPayload["contacts"][number], key: LeadSortKey): string | number => {
      const stage = stages[getLeadId(lead)] ?? defaultStage(lead.priority, lead.activeEntries);
      if (key === "name") return lead.name;
      if (key === "segment") return getLeadSegmentLabel(getLeadSegment(lead.reason));
      if (key === "reason") return lead.reason;
      if (key === "priority") return priorityOrder[lead.priority];
      if (key === "stage") return stageOrder[stage];
      if (key === "lastPurchaseDate") return new Date(lead.lastPurchaseDate).getTime();
      if (key === "daysSinceLastPurchase") return lead.daysSinceLastPurchase;
      if (key === "activeEntries") return lead.activeEntries ?? -1;
      if (key === "email") return lead.email ?? "";
      if (key === "phone") return lead.phone ?? "";
      return lead.lifetimeRevenue;
    };

    const sorted = [...filteredLeads].sort((a, b) => {
      const aVal = getValue(a, sortBy.key);
      const bVal = getValue(b, sortBy.key);
      const comparison = typeof aVal === "number" && typeof bVal === "number"
        ? compareNumber(aVal, bVal)
        : compareText(String(aVal), String(bVal));
      return sortBy.direction === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [filteredLeads, sortBy, stages]);

  const toggleSort = (key: LeadSortKey) => {
    setSortBy((previous) => {
      if (!previous || previous.key !== key) {
        const defaultDirection: SortDirection = (key === "daysSinceLastPurchase" || key === "activeEntries" || key === "lifetimeRevenue" || key === "lastPurchaseDate")
          ? "desc"
          : "asc";
        return { key, direction: defaultDirection };
      }
      return { key, direction: previous.direction === "asc" ? "desc" : "asc" };
    });
  };

  return (
    <AppShell title="Sprzedaż">
      {isLoading ? (
        <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-4 text-sm text-muted-foreground shadow-[0_12px_32px_rgba(11,22,39,0.06)]">
          Ładowanie leadów...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
      ) : (
        <div className="grid gap-4">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="Leady aktywne" value={String(summary.leads)} />
            <SummaryCard label="Wysoki priorytet" value={String(summary.urgent)} accent="rose" />
            <SummaryCard label="Po wejściu pojedynczym" value={String(summary.singleToPass)} accent="emerald" />
            <SummaryCard label="Do odnowienia karnetu" value={String(summary.passRenewal)} accent="amber" />
          </section>

          <section className="grid gap-3 xl:grid-cols-3">
            <SummaryCard label="Potencjał LTV leadów" value={money.format(summary.ltv)} accent="sky" />
            <SummaryCard label="Śr. dni bez zakupu" value={String(summary.avgDays)} accent="amber" />
            <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/70 p-3 shadow-[0_12px_32px_rgba(11,22,39,0.06)]">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Sugerowany fokus</p>
              <p className="mt-1 text-sm font-semibold text-emerald-900">
                {summary.singleToPass >= summary.passRenewal ? "Konwersja wejść pojedynczych na karnety." : "Domykanie odnowień karnetów."}
              </p>
              <p className="mt-1 text-xs text-emerald-800">Największy wpływ na przychód daje kontakt telefoniczny w ciągu 24h.</p>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-[0_12px_32px_rgba(11,22,39,0.06)]">
            <div className="grid gap-2 md:grid-cols-4">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Szukaj klienta, email, telefon..."
                className="h-9 rounded-md border border-slate-300 px-3 text-sm outline-none ring-slate-300 focus:ring-2"
              />
              <select
                value={priorityFilter}
                onChange={(event) => setPriorityFilter(event.target.value as "all" | LeadPriority)}
                className="h-9 rounded-md border border-slate-300 px-3 text-sm outline-none ring-slate-300 focus:ring-2"
              >
                <option value="all">Priorytet: wszystkie</option>
                <option value="wysoki">Wysoki</option>
                <option value="sredni">Średni</option>
                <option value="niski">Niski</option>
              </select>
              <select
                value={reasonFilter}
                onChange={(event) => setReasonFilter(event.target.value as "all" | "single" | "pass" | "inactive")}
                className="h-9 rounded-md border border-slate-300 px-3 text-sm outline-none ring-slate-300 focus:ring-2"
              >
                <option value="all">Powód: wszystkie</option>
                <option value="single">Po wejściu pojedynczym ({reasonOptions.single})</option>
                <option value="pass">Nieprzedłużony karnet ({reasonOptions.pass})</option>
                <option value="inactive">Brak aktywności ({reasonOptions.inactive})</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setPriorityFilter("all");
                  setReasonFilter("all");
                }}
                className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm hover:bg-slate-50"
              >
                Wyczyść filtry
              </button>
            </div>
          </section>

          <section className="grid gap-3 md:hidden">
            <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-[0_12px_32px_rgba(11,22,39,0.06)]">
              <h3 className="mb-2 text-sm font-semibold text-slate-800">Pipeline</h3>
              <div className="grid grid-cols-2 gap-2">
                {LEAD_STAGE_OPTIONS.map((stage) => (
                  <div key={stage.value} className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
                    <p className="text-[11px] font-semibold text-slate-500">{stage.label}</p>
                    <p className="mt-1 text-lg font-extrabold text-slate-900">{stageBuckets[stage.value].length}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="hidden gap-3 md:grid xl:grid-cols-5">
            {LEAD_STAGE_OPTIONS.map((stage) => (
              <PipelineColumn key={stage.value} title={stage.label} rows={stageBuckets[stage.value]} studioUuid={data?.studioUuid} />
            ))}
          </section>

          <section className="rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-[0_12px_32px_rgba(11,22,39,0.06)] md:hidden">
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Leady sprzedażowe</h3>
            <div className="space-y-3">
              {sortedLeads.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-muted-foreground">
                  Brak leadów dla wybranych filtrów.
                </div>
              ) : (
                sortedLeads.map((lead) => {
                  const leadId = getLeadId(lead);
                  const stage = stages[leadId] ?? defaultStage(lead.priority, lead.activeEntries);
                  const segment = getLeadSegment(lead.reason);
                  return (
                    <article
                      key={`${leadId}-${lead.lastPurchaseDate}`}
                      className={`rounded-xl border px-3 py-3 ${
                        lead.priority === "wysoki" ? "border-rose-200 bg-rose-50/50" : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            <ClientNameLink name={lead.name} studioUuid={data?.studioUuid} clientGuid={lead.clientGuid} />
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            <span className={getLeadSegmentBadgeClass(segment)}>{getLeadSegmentLabel(segment)}</span>
                            <span className={getPriorityBadgeClass(lead.priority)}>{lead.priority}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-[11px] text-slate-500">LTV</p>
                          <p className="text-sm font-bold text-slate-900">{money.format(lead.lifetimeRevenue)}</p>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        <span className="text-slate-500">Ostatni zakup</span>
                        <span className="text-right text-slate-800">{new Date(lead.lastPurchaseDate).toLocaleDateString("pl-PL")}</span>
                        <span className="text-slate-500">Dni bez zakupu</span>
                        <span className="text-right text-slate-800">{lead.daysSinceLastPurchase}</span>
                        <span className="text-slate-500">Aktywne wejścia</span>
                        <span className="text-right text-slate-800">{lead.activeEntries ?? "-"}</span>
                      </div>

                      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Powód kontaktu</p>
                        <p className="mt-1 text-sm text-slate-800">{lead.reason}</p>
                        <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sugerowana akcja</p>
                        <p className="mt-1 text-sm text-slate-800">{getSuggestedAction(segment, lead.activeEntries)}</p>
                      </div>

                      <div className="mt-3">
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Status</label>
                        <select
                          value={stage}
                          onChange={(event) =>
                            setStages((previous) => ({
                              ...previous,
                              [leadId]: event.target.value as LeadStage,
                            }))}
                          className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                        >
                          {LEAD_STAGE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="mt-3 flex flex-col gap-2 text-sm">
                        <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
                          <span className="text-slate-500">Email</span>
                          <div className="min-w-0 text-right">
                            <ContactValueLink type="email" value={lead.email} />
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
                          <span className="text-slate-500">Telefon</span>
                          <div className="min-w-0 text-right">
                            <ContactValueLink type="phone" value={lead.phone} />
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>

          <section className="hidden rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-[0_12px_32px_rgba(11,22,39,0.06)] md:block">
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Leady sprzedażowe</h3>
            <div className="max-w-full overflow-x-auto">
              <Table className="min-w-[1120px] text-xs">
                <TableHeader>
                  <TableRow>
                    <SortableHead label="Klient" sortKey="name" sortBy={sortBy} onSort={toggleSort} />
                    <SortableHead label="Typ leada" sortKey="segment" sortBy={sortBy} onSort={toggleSort} />
                    <SortableHead label="Powód kontaktu" sortKey="reason" sortBy={sortBy} onSort={toggleSort} />
                    <TableHead>Sugerowana akcja</TableHead>
                    <SortableHead label="Priorytet" sortKey="priority" sortBy={sortBy} onSort={toggleSort} />
                    <SortableHead label="Status" sortKey="stage" sortBy={sortBy} onSort={toggleSort} />
                    <SortableHead label="Ostatni zakup" sortKey="lastPurchaseDate" sortBy={sortBy} onSort={toggleSort} />
                    <SortableHead label="Dni bez zakupu" sortKey="daysSinceLastPurchase" sortBy={sortBy} onSort={toggleSort} align="right" />
                    <SortableHead label="Aktywne wejścia" sortKey="activeEntries" sortBy={sortBy} onSort={toggleSort} align="right" />
                    <SortableHead label="Email" sortKey="email" sortBy={sortBy} onSort={toggleSort} />
                    <SortableHead label="Telefon" sortKey="phone" sortBy={sortBy} onSort={toggleSort} />
                    <SortableHead label="LTV" sortKey="lifetimeRevenue" sortBy={sortBy} onSort={toggleSort} align="right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedLeads.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-muted-foreground">
                        Brak leadów dla wybranych filtrów.
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedLeads.map((lead) => {
                      const leadId = getLeadId(lead);
                      const stage = stages[leadId] ?? defaultStage(lead.priority, lead.activeEntries);
                      const segment = getLeadSegment(lead.reason);
                      return (
                        <TableRow key={`${leadId}-${lead.lastPurchaseDate}`} className={lead.priority === "wysoki" ? "bg-rose-50/60" : ""}>
                          <TableCell>
                            <ClientNameLink name={lead.name} studioUuid={data?.studioUuid} clientGuid={lead.clientGuid} />
                          </TableCell>
                          <TableCell>
                            <span className={getLeadSegmentBadgeClass(segment)}>{getLeadSegmentLabel(segment)}</span>
                          </TableCell>
                          <TableCell>{lead.reason}</TableCell>
                          <TableCell className="max-w-[280px] text-slate-700">{getSuggestedAction(segment, lead.activeEntries)}</TableCell>
                          <TableCell>
                            <span className={getPriorityBadgeClass(lead.priority)}>{lead.priority}</span>
                          </TableCell>
                          <TableCell>
                            <select
                              value={stage}
                              onChange={(event) =>
                                setStages((previous) => ({
                                  ...previous,
                                  [leadId]: event.target.value as LeadStage,
                                }))}
                              className="h-8 rounded-md border border-slate-300 px-2 text-xs"
                            >
                              {LEAD_STAGE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </TableCell>
                          <TableCell>{new Date(lead.lastPurchaseDate).toLocaleDateString("pl-PL")}</TableCell>
                          <TableCell className="text-right">{lead.daysSinceLastPurchase}</TableCell>
                          <TableCell className="text-right">{lead.activeEntries ?? "-"}</TableCell>
                          <TableCell>
                            <ContactValueLink type="email" value={lead.email} />
                          </TableCell>
                          <TableCell>
                            <ContactValueLink type="phone" value={lead.phone} />
                          </TableCell>
                          <TableCell className="text-right">{money.format(lead.lifetimeRevenue)}</TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}

function SummaryCard({
  label,
  value,
  accent = "slate",
}: {
  label: string;
  value: string;
  accent?: "slate" | "rose" | "sky" | "amber" | "emerald";
}) {
  const accentMap: Record<string, string> = {
    slate: "text-slate-800",
    rose: "text-rose-700",
    sky: "text-sky-700",
    amber: "text-amber-700",
    emerald: "text-emerald-700",
  };
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-[0_12px_32px_rgba(11,22,39,0.06)]">
      <p className="text-[11px] font-semibold text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-extrabold ${accentMap[accent]}`}>{value}</p>
    </div>
  );
}

function PipelineColumn({
  title,
  rows,
  studioUuid,
}: {
  title: string;
  rows: SalesPayload["contacts"];
  studioUuid?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white/90 p-3 shadow-[0_12px_32px_rgba(11,22,39,0.06)]">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{rows.length}</span>
      </div>
      <div className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">Brak leadów</p>
        ) : (
          rows.slice(0, 6).map((lead) => (
            <div key={`${title}-${getLeadId(lead)}`} className="rounded-xl border border-slate-200 bg-slate-50/70 px-2 py-2 text-xs">
              <div className="font-medium text-slate-800">
                <ClientNameLink name={lead.name} studioUuid={studioUuid} clientGuid={lead.clientGuid} />
              </div>
              <p className="mt-0.5 line-clamp-2 text-slate-600">{lead.reason}</p>
              <p className="mt-1 text-[11px] text-slate-500">Dni bez zakupu: {lead.daysSinceLastPurchase}</p>
            </div>
          ))
        )}
      </div>
    </div>
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

  if (!hasValue) return <span className="text-slate-400">-</span>;
  return (
    <a href={href} className="break-all underline decoration-slate-300 underline-offset-2 hover:text-sky-700 hover:decoration-sky-400">
      {normalized}
    </a>
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
    <a href={href} target="_blank" rel="noreferrer" className="underline decoration-slate-300 underline-offset-2 hover:text-sky-700 hover:decoration-sky-400">
      {name}
    </a>
  );
}

function getPriorityBadgeClass(priority: LeadPriority) {
  if (priority === "wysoki") return "inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700";
  if (priority === "sredni") return "inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700";
  return "inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700";
}

function getLeadSegmentBadgeClass(segment: LeadSegment) {
  if (segment === "single_to_pass") return "inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700";
  if (segment === "pass_renewal") return "inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700";
  return "inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700";
}

function SortableHead({
  label,
  sortKey,
  sortBy,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: LeadSortKey;
  sortBy: { key: LeadSortKey; direction: SortDirection } | null;
  onSort: (key: LeadSortKey) => void;
  align?: "left" | "right";
}) {
  const isActive = sortBy?.key === sortKey;
  const marker = !isActive ? "↕" : sortBy.direction === "asc" ? "↑" : "↓";
  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 text-xs font-semibold hover:text-slate-900 ${align === "right" ? "ml-auto" : ""}`}
      >
        <span>{label}</span>
        <span className="text-[10px] text-slate-500">{marker}</span>
      </button>
    </TableHead>
  );
}
