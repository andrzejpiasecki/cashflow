"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton, useAuth } from "@clerk/nextjs";

type AppShellProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

const AUTO_IMPORT_CLIENT_CHECK_KEY = "fitssey_auto_import_last_checked_at";
const AUTO_IMPORT_CLIENT_CHECK_INTERVAL_MS = 60 * 1000;
const AUTO_IMPORT_COMPLETED_KEY = "fitssey_auto_import_completed_at";
const AUTO_IMPORT_PATHS = new Set(["/cashflow", "/dashboard", "/sales", "/client-history"]);

export function AppShell({ title, subtitle, children }: AppShellProps) {
  const pathname = usePathname();
  const { isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !AUTO_IMPORT_PATHS.has(pathname)) return;

    let cancelled = false;
    let inFlight = false;
    let pendingForegroundRefresh = false;
    let lastForegroundStartedAt = 0;

    const runAutoImportCheck = (trigger: "interval" | "foreground" = "interval") => {
      if (cancelled || document.visibilityState === "hidden") return;
      const now = Date.now();
      const isForeground = trigger === "foreground";
      // Mobile browsers can deliver focus, visibilitychange and pageshow for one resume.
      if (isForeground && now - lastForegroundStartedAt < 1000) return;
      if (inFlight) {
        if (isForeground) pendingForegroundRefresh = true;
        return;
      }
      const lastCheckedAt = Number(window.localStorage.getItem(AUTO_IMPORT_CLIENT_CHECK_KEY) ?? 0);
      if (!isForeground && Number.isFinite(lastCheckedAt) && now - lastCheckedAt < AUTO_IMPORT_CLIENT_CHECK_INTERVAL_MS) return;
      if (isForeground) lastForegroundStartedAt = now;

      inFlight = true;
      void fetch("/api/fitssey/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto: true, trigger }),
      })
        .then(async (response) => {
          const payload = (await response.json().catch(() => ({}))) as { skipped?: boolean; lastImportedAt?: string };
          if (response.ok) {
            window.localStorage.setItem(AUTO_IMPORT_CLIENT_CHECK_KEY, String(Date.now()));
            const completedAt = payload.lastImportedAt;
            const previous = window.localStorage.getItem(AUTO_IMPORT_COMPLETED_KEY);
            if (completedAt && completedAt !== previous) {
              window.localStorage.setItem(AUTO_IMPORT_COMPLETED_KEY, completedAt);
              window.dispatchEvent(new CustomEvent("fitssey:auto-import-completed"));
            }
          }
        })
        .catch(() => {
          // Auto-refresh is opportunistic; pages still render cached data if Fitssey is unavailable.
        })
        .finally(() => {
          inFlight = false;
          if (pendingForegroundRefresh) {
            pendingForegroundRefresh = false;
            runAutoImportCheck("foreground");
          }
        });
    };

    const runOnForeground = () => runAutoImportCheck("foreground");
    const runWhenVisible = () => {
      if (document.visibilityState === "visible") runOnForeground();
    };
    const runOnPageRestore = (event: PageTransitionEvent) => {
      if (event.persisted) runOnForeground();
    };

    const onOtherTabImport = (event: StorageEvent) => {
      if (event.key === AUTO_IMPORT_COMPLETED_KEY && event.newValue) {
        window.dispatchEvent(new CustomEvent("fitssey:auto-import-completed"));
      }
    };

    runOnForeground();
    const intervalId = window.setInterval(() => runAutoImportCheck(), AUTO_IMPORT_CLIENT_CHECK_INTERVAL_MS);
    window.addEventListener("focus", runOnForeground);
    window.addEventListener("pageshow", runOnPageRestore);
    window.addEventListener("online", runOnForeground);
    window.addEventListener("storage", onOtherTabImport);
    document.addEventListener("visibilitychange", runWhenVisible);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", runOnForeground);
      window.removeEventListener("pageshow", runOnPageRestore);
      window.removeEventListener("online", runOnForeground);
      window.removeEventListener("storage", onOtherTabImport);
      document.removeEventListener("visibilitychange", runWhenVisible);
    };
  }, [isLoaded, isSignedIn, pathname]);

  if (!isLoaded) {
    return <main className="p-6 text-sm text-muted-foreground">Ładowanie...</main>;
  }

  if (!isSignedIn) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="rounded-sm border border-slate-300 bg-white p-6 text-center">
          <h1 className="mb-2 text-xl font-semibold">Zaloguj się</h1>
          <p className="mb-4 text-sm text-muted-foreground">Aby korzystać z modułów cashflow i dashboardu.</p>
          <Link
            href="/sign-in"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Zaloguj
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex w-full max-w-none flex-1 flex-col gap-4 px-2 py-3 sm:px-4">
      <header className="rounded-sm border border-slate-300 bg-white px-3 py-2">
        <div className="flex min-h-10 items-center justify-between gap-3">
          <div className="space-y-0.5 leading-none">
            <h1 className="text-xl font-semibold">{title}</h1>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="h-8 w-8 shrink-0">
            <UserButton userProfileMode="navigation" userProfileUrl="/user-profile" />
          </div>
        </div>

        <nav className="mt-2 grid min-h-9 grid-cols-[max-content_repeat(4,minmax(max-content,1fr))] gap-1 overflow-x-auto sm:mt-3 sm:grid-cols-5 sm:gap-2">
          <Link
            href="/dashboard"
            className={`inline-flex h-9 items-center justify-center rounded-sm border px-1 text-xs font-medium sm:px-2 sm:text-sm ${pathname === "/dashboard" ? "bg-slate-900 text-white" : "bg-white text-slate-900"}`}
          >
            Dashboard
          </Link>
          <Link
            href="/cashflow"
            className={`inline-flex h-9 items-center justify-center rounded-sm border px-1 text-xs font-medium sm:px-2 sm:text-sm ${pathname === "/cashflow" ? "bg-slate-900 text-white" : "bg-white text-slate-900"}`}
          >
            Cashflow
          </Link>
          <Link
            href="/sales"
            className={`inline-flex h-9 items-center justify-center rounded-sm border px-1 text-xs font-medium sm:px-2 sm:text-sm ${pathname === "/sales" ? "bg-slate-900 text-white" : "bg-white text-slate-900"}`}
          >
            Sprzedaż
          </Link>
          <Link
            href="/client-history"
            className={`inline-flex h-9 items-center justify-center rounded-sm border px-1 text-xs font-medium sm:px-2 sm:text-sm ${pathname === "/client-history" ? "bg-slate-900 text-white" : "bg-white text-slate-900"}`}
          >
            <span className="sm:hidden">Klienci</span><span className="hidden sm:inline">Historia klientów</span>
          </Link>
          <Link
            href="/settings"
            className={`inline-flex h-9 items-center justify-center rounded-sm border px-1 text-xs font-medium sm:px-2 sm:text-sm ${pathname === "/settings" ? "bg-slate-900 text-white" : "bg-white text-slate-900"}`}
          >
            Settings
          </Link>
        </nav>
      </header>
      {children}
    </main>
  );
}
