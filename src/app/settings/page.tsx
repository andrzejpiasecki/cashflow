"use client";

import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type SettingsPayload = {
  studioUuid: string;
  apiKeyConfigured: boolean;
  apiKeyPreview?: string | null;
  startDate: string;
  citRate: number;
  vatRate: number;
  autoImportIntervalMins: number;
  welcomeSmsMessage: string;
  smsTemplates: SmsTemplate[];
  lastImportedAt: string | null;
  lastImportStatus: string | null;
};

type SmsTemplate = {
  id: string;
  label: string;
  message: string;
};

type SettingsTab = "fitssey" | "taxes" | "sms" | "system";

async function parseResponsePayload(response: Response) {
  const text = await response.text();
  if (!text) return {} as SettingsPayload & { error?: string };
  try {
    return JSON.parse(text) as SettingsPayload & { error?: string };
  } catch {
    return {} as SettingsPayload & { error?: string };
  }
}

function formatBuildTime(value: string | undefined) {
  if (!value) return "brak danych";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pl-PL");
}

const DEFAULT_WELCOME_SMS_MESSAGE = "Cześć {imie}, tu Reforma Pilates. Dziękujemy za zakup i witamy w studiu! Jeśli masz pytania albo chcesz dobrać termin zajęć, odpisz na tę wiadomość.";
const DEFAULT_SMS_TEMPLATES: SmsTemplate[] = [
  { id: "welcome", label: "Powitalny", message: DEFAULT_WELCOME_SMS_MESSAGE },
  {
    id: "first_visit",
    label: "Pierwsza wizyta",
    message: "Dzień dobry {imie}! Przypominamy, że jeśli to Twoje pierwsze zajęcia na reformerze, najlepiej wybrać grupę Reformer Start. Do zobaczenia w Studio Re•forma.",
  },
  {
    id: "renewal",
    label: "Odnowienie karnetu",
    message: "Cześć {imie}, tu Reforma Pilates. Twój karnet dobiega końca lub jest już po terminie. Jeśli chcesz kontynuować zajęcia, odpisz na tę wiadomość, a pomożemy dobrać termin.",
  },
];

const SETTINGS_TABS: { value: SettingsTab; label: string }[] = [
  { value: "fitssey", label: "Fitssey" },
  { value: "taxes", label: "Podatki" },
  { value: "sms", label: "SMS" },
  { value: "system", label: "System" },
];

export default function SettingsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncingContacts, setIsSyncingContacts] = useState(false);
  const [status, setStatus] = useState("");
  const [activeTab, setActiveTab] = useState<SettingsTab>("fitssey");

  const [studioUuid, setStudioUuid] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [startDate, setStartDate] = useState("");
  const [citRate, setCitRate] = useState(19);
  const [vatRate, setVatRate] = useState(23);
  const [autoImportIntervalMins, setAutoImportIntervalMins] = useState(180);
  const [smsTemplates, setSmsTemplates] = useState<SmsTemplate[]>(DEFAULT_SMS_TEMPLATES);
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
  const [apiKeyPreview, setApiKeyPreview] = useState<string | null>(null);
  const [lastImportedAt, setLastImportedAt] = useState<string | null>(null);
  const [lastImportStatus, setLastImportStatus] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setStatus("");
    try {
      const response = await fetch("/api/settings/fitssey");
      const payload = await parseResponsePayload(response);
      if (!response.ok) {
        setStatus(payload.error ?? "Nie udało się pobrać ustawień.");
        return;
      }
      const data = payload;
      setStudioUuid(data.studioUuid ?? "");
      setStartDate(data.startDate ?? "");
      setCitRate(Number(data.citRate ?? 19));
      setVatRate(Number(data.vatRate ?? 23));
      setAutoImportIntervalMins(Number(data.autoImportIntervalMins ?? 180));
      setSmsTemplates(data.smsTemplates?.length ? data.smsTemplates : [{ ...DEFAULT_SMS_TEMPLATES[0], message: data.welcomeSmsMessage || DEFAULT_WELCOME_SMS_MESSAGE }, ...DEFAULT_SMS_TEMPLATES.slice(1)]);
      setApiKeyConfigured(Boolean(data.apiKeyConfigured));
      setApiKeyPreview(data.apiKeyPreview ?? null);
      setLastImportedAt(data.lastImportedAt ?? null);
      setLastImportStatus(data.lastImportStatus ?? null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    setIsSaving(true);
    setStatus("");
    try {
      const response = await fetch("/api/settings/fitssey", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studioUuid,
          apiKey,
          startDate,
          citRate,
          vatRate,
          autoImportIntervalMins,
          welcomeSmsMessage: smsTemplates.find((template) => template.id === "welcome")?.message ?? DEFAULT_WELCOME_SMS_MESSAGE,
          smsTemplates,
        }),
      });
      const payload = await parseResponsePayload(response);
      if (!response.ok) {
        setStatus(payload.error ?? "Nie udało się zapisać ustawień.");
        return;
      }
      setApiKey("");
      setApiKeyConfigured(Boolean(payload.apiKeyConfigured));
      setApiKeyPreview(payload.apiKeyPreview ?? null);
      setLastImportedAt(payload.lastImportedAt ?? null);
      setLastImportStatus(payload.lastImportStatus ?? null);
      setAutoImportIntervalMins(Number(payload.autoImportIntervalMins ?? autoImportIntervalMins));
      setSmsTemplates(payload.smsTemplates?.length ? payload.smsTemplates : smsTemplates);
      setStatus("Ustawienia zapisane.");
    } finally {
      setIsSaving(false);
    }
  };

  const refreshFitsseyData = async () => {
    setIsRefreshing(true);
    setStatus("");
    try {
      const response = await fetch("/api/fitssey/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto: false }),
      });
      const payload = await parseResponsePayload(response);
      if (!response.ok) {
        setStatus(payload.error ?? "Nie udało się odświeżyć danych Fitssey.");
        return;
      }
      await load();
      setStatus("Dane Fitssey zostały odświeżone.");
    } finally {
      setIsRefreshing(false);
    }
  };

  const syncFitsseyContacts = async () => {
    setIsSyncingContacts(true);
    setStatus("");
    try {
      const response = await fetch("/api/fitssey/client-contacts/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; fetched?: number; contactsUpserted?: number };
      if (!response.ok) {
        setStatus(payload.error ?? "Nie udało się zsynchronizować kontaktów Fitssey.");
        return;
      }
      setStatus(`Kontakty zsynchronizowane: ${payload.contactsUpserted ?? 0}/${payload.fetched ?? 0}.`);
    } finally {
      setIsSyncingContacts(false);
    }
  };

  const updateSmsTemplate = (id: string, patch: Partial<SmsTemplate>) => {
    setSmsTemplates((templates) => templates.map((template) => template.id === id ? { ...template, ...patch } : template));
  };

  const addSmsTemplate = () => {
    setSmsTemplates((templates) => [
      ...templates,
      {
        id: crypto.randomUUID(),
        label: "Nowy SMS",
        message: "Cześć {imie}, ",
      },
    ]);
  };

  const removeSmsTemplate = (id: string) => {
    if (id === "welcome") return;
    setSmsTemplates((templates) => templates.filter((template) => template.id !== id));
  };

  return (
    <AppShell title="Settings">
      <div className="rounded-sm border border-slate-300 bg-white p-4 text-sm">
        {isLoading ? (
          <p className="text-muted-foreground">Ładowanie ustawień...</p>
        ) : (
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SETTINGS_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setActiveTab(tab.value)}
                  className={`h-9 rounded-sm border px-3 text-sm font-medium ${activeTab === tab.value ? "bg-slate-900 text-white" : "bg-white text-slate-900"}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === "fitssey" && (
              <section className="grid gap-3">
                <label className="grid gap-1">
                  <span className="text-xs text-muted-foreground">Studio UUID</span>
                  <Input value={studioUuid} onChange={(event) => setStudioUuid(event.target.value)} placeholder="Reformapilates" />
                </label>

                <label className="grid gap-1">
                  <span className="text-xs text-muted-foreground">API Key Fitssey {apiKeyConfigured ? "(skonfigurowany)" : ""}</span>
                  <Input
                    type="text"
                    autoComplete="off"
                    name="fitssey-api-key"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={apiKeyConfigured ? "Pozostaw puste, aby nie zmieniać" : "wklej api key fitssey"}
                  />
                  {apiKeyConfigured && apiKeyPreview && <span className="text-xs text-muted-foreground">Zapisany: {apiKeyPreview}</span>}
                </label>

                <label className="grid gap-1">
                  <span className="text-xs text-muted-foreground">Data startu importu</span>
                  <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
                </label>
              </section>
            )}

            {activeTab === "taxes" && (
              <section className="grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-xs text-muted-foreground">CIT %</span>
                  <Input type="number" value={citRate} onChange={(event) => setCitRate(Number(event.target.value) || 0)} min={0} max={100} />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs text-muted-foreground">VAT %</span>
                  <Input type="number" value={vatRate} onChange={(event) => setVatRate(Number(event.target.value) || 0)} min={0} max={100} />
                </label>
              </section>
            )}

            {activeTab === "sms" && (
              <section className="grid gap-3">
                <div className="rounded-sm border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-muted-foreground">
                  Użyj {'{imie}'} lub {'{imię}'}, żeby automatycznie wstawić imię klienta. Szablony są dostępne w tabeli ostatnich zakupów na dashboardzie.
                </div>
                {smsTemplates.map((template) => (
                  <div key={template.id} className="grid gap-2 rounded-sm border border-slate-200 p-3">
                    <div className="flex items-center gap-2">
                      <Input value={template.label} onChange={(event) => updateSmsTemplate(template.id, { label: event.target.value })} className="h-9" />
                      {template.id !== "welcome" && (
                        <Button variant="ghost" className="h-9 border bg-white px-3" onClick={() => removeSmsTemplate(template.id)}>
                          Usuń
                        </Button>
                      )}
                    </div>
                    <textarea
                      value={template.message}
                      onChange={(event) => updateSmsTemplate(template.id, { message: event.target.value })}
                      className="min-h-28 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                ))}
                <Button variant="ghost" className="h-9 w-fit border bg-white px-3" onClick={addSmsTemplate}>
                  + Dodaj typ SMS
                </Button>
              </section>
            )}

            {activeTab === "system" && (
              <section className="grid gap-2 text-xs text-muted-foreground">
                <div>Ostatni import: {lastImportedAt ? new Date(lastImportedAt).toLocaleString("pl-PL") : "brak"}</div>
                <div>Status: {lastImportStatus ?? "brak"}</div>
                <div>Build aplikacji: {formatBuildTime(process.env.NEXT_PUBLIC_BUILD_TIME)}</div>
                <label className="mt-2 grid max-w-xs gap-1 text-sm text-slate-700">
                  <span className="text-xs text-muted-foreground">Auto-odświeżanie Fitssey co ile minut</span>
                  <Input
                    type="number"
                    value={autoImportIntervalMins}
                    onChange={(event) => setAutoImportIntervalMins(Number(event.target.value) || 180)}
                    min={15}
                    max={1440}
                  />
                  <span className="text-xs text-muted-foreground">Minimum 15 min. Aplikacja sprawdza częściej, ale Fitssey jest wołany dopiero po tym interwale.</span>
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                <Button onClick={refreshFitsseyData} disabled={isSaving || isRefreshing || isSyncingContacts} variant="ghost" className="h-9 w-fit border bg-white px-3">
                  {isRefreshing ? "Odświeżanie..." : "Odśwież dane Fitssey"}
                </Button>
                <Button onClick={syncFitsseyContacts} disabled={isSaving || isRefreshing || isSyncingContacts} variant="ghost" className="h-9 w-fit border bg-white px-3">
                  {isSyncingContacts ? "Synchronizacja..." : "Synchronizuj telefony klientów"}
                </Button>
                </div>
              </section>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
              <Button onClick={save} disabled={isSaving || isRefreshing || isSyncingContacts}>
                {isSaving ? "Zapisywanie..." : "Zapisz ustawienia"}
              </Button>
              {status && <span className="text-xs text-muted-foreground">{status}</span>}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
