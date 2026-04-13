"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton, useAuth } from "@clerk/nextjs";

type AppShellProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

export function AppShell({ title, subtitle, children }: AppShellProps) {
  const pathname = usePathname();
  const { isLoaded, isSignedIn } = useAuth();

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
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-slate-300 bg-white px-3 py-2">
        <div className="space-y-0.5">
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <nav className="flex items-center gap-2">
          <Link
            href="/cashflow"
            className={`rounded-sm border px-3 py-1.5 text-sm ${pathname === "/cashflow" ? "bg-slate-900 text-white" : "bg-white"}`}
          >
            Cashflow
          </Link>
          <Link
            href="/dashboard"
            className={`rounded-sm border px-3 py-1.5 text-sm ${pathname === "/dashboard" ? "bg-slate-900 text-white" : "bg-white"}`}
          >
            Dashboard
          </Link>
          <Link
            href="/settings"
            className={`rounded-sm border px-3 py-1.5 text-sm ${pathname === "/settings" ? "bg-slate-900 text-white" : "bg-white"}`}
          >
            Settings
          </Link>
        </nav>
        <UserButton userProfileMode="navigation" userProfileUrl="/user-profile" />
      </header>
      {children}
    </main>
  );
}
