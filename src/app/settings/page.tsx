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
  lastImportedAt: string | null;
  lastImportStatus: string | null;
};

async function parseResponsePayload(response: Response) {
  const text = await response.text();
  if (!text) return {} as SettingsPayload & { error?: string };
  try {
    return JSON.parse(text) as SettingsPayload & { error?: string };
  } catch {
    return {} as SettingsPayload & { error?: string };
  }
}

export default function SettingsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [status, setStatus] = useState("");

  const [studioUuid, setStudioUuid] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [startDate, setStartDate] = useState("");
  const [citRate, setCitRate] = useState(19);
  const [vatRate, setVatRate] = useState(23);
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

  return (
    <AppShell title="Settings">
      <div className="rounded-sm border border-slate-300 bg-white p-4 text-sm">
        {isLoading ? (
          <p className="text-muted-foreground">Ładowanie ustawień...</p>
        ) : (
          <div className="grid gap-3">
            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">Studio UUID</span>
              <Input value={studioUuid} onChange={(event) => setStudioUuid(event.target.value)} placeholder="Reformapilates" />
            </label>

            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">API Key Fitssey {apiKeyConfigured ? "(skonfigurowany)" : ""}</span>
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  autoComplete="off"
                  name="fitssey-api-key"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={apiKeyConfigured ? "Pozostaw puste, aby nie zmieniać" : "wklej api key fitssey"}
                />
              </div>
              {apiKeyConfigured && apiKeyPreview && <span className="text-xs text-muted-foreground">Zapisany: {apiKeyPreview}</span>}
            </label>

            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">Data startu importu</span>
              <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs text-muted-foreground">CIT %</span>
                <Input type="number" value={citRate} onChange={(event) => setCitRate(Number(event.target.value) || 0)} min={0} max={100} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-muted-foreground">VAT %</span>
                <Input type="number" value={vatRate} onChange={(event) => setVatRate(Number(event.target.value) || 0)} min={0} max={100} />
              </label>
            </div>

            <div className="text-xs text-muted-foreground">
              Ostatni import: {lastImportedAt ? new Date(lastImportedAt).toLocaleString("pl-PL") : "brak"}
            </div>
            <div className="text-xs text-muted-foreground">Status: {lastImportStatus ?? "brak"}</div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={save} disabled={isSaving || isRefreshing}>
                {isSaving ? "Zapisywanie..." : "Zapisz ustawienia"}
              </Button>
              <Button onClick={refreshFitsseyData} disabled={isSaving || isRefreshing} variant="ghost">
                {isRefreshing ? "Odświeżanie..." : "Odśwież dane Fitssey"}
              </Button>
              {status && <span className="text-xs text-muted-foreground">{status}</span>}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
