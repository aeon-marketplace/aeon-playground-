"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import {
  History,
  KeyRound,
  LayoutGrid,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  shortLabel: string;
  icon: typeof MessageSquare;
};

type NavGroup = { label: string; items: NavItem[] };

const MAIN_NAV: NavItem[] = [
  {
    href: "/playground",
    label: "Playground",
    shortLabel: "Playground",
    icon: MessageSquare,
  },
  {
    href: "/models",
    label: "Model Catalog",
    shortLabel: "Catalog",
    icon: LayoutGrid,
  },
  { href: "/api-keys", label: "API Keys", shortLabel: "Keys", icon: KeyRound },
  { href: "/history", label: "Test History", shortLabel: "History", icon: History },
];

function navGroupsFor(): NavGroup[] {
  return [{ label: "Workbench", items: MAIN_NAV }];
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/playground") {
    return pathname === "/playground" || pathname.startsWith("/playground/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/playground" className="flex min-w-0 items-center gap-2.5" aria-label="AI Playground — AEON">
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-xl border border-blue-400/25 bg-[#040918]/70 shadow-lg shadow-blue-500/10",
          compact ? "h-9 w-9" : "h-10 px-2.5",
        )}
      >
        <Image
          src="/aeon-wordmark.png"
          alt="AEON"
          width={232}
          height={76}
          priority
          className={compact ? "h-3.5 w-auto" : "h-4 w-auto"}
        />
      </span>
      {!compact ? (
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm font-semibold tracking-tight text-white">
            AI Playground
          </span>
          <span className="block truncate text-[10px] uppercase tracking-[0.18em] text-blue-300/60">
            text + image · real inference
          </span>
        </span>
      ) : null}
    </Link>
  );
}

function NavLinks({
  pathname,
  collapsed = false,
  onNavigate,
}: {
  pathname: string;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav className="space-y-5" aria-label="Main navigation">
      {navGroupsFor().map((group) => (
        <div key={group.label}>
          {!collapsed ? (
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">
              {group.label}
            </p>
          ) : (
            <div className="mx-2 mb-1.5 border-t border-white/5" />
          )}
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                    collapsed && "justify-center px-0",
                    active
                      ? "bg-blue-500/15 text-white shadow-[inset_0_0_0_1px_rgba(59,130,246,0.32)]"
                      : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-100",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-[18px] w-[18px] shrink-0",
                      active
                        ? "text-blue-300"
                        : "text-slate-500 group-hover:text-slate-300",
                    )}
                  />
                  {!collapsed ? (
                    <>
                      <span className="truncate">{item.label}</span>
                      {active ? (
                        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-400" />
                      ) : null}
                    </>
                  ) : null}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

const SIDEBAR_STORAGE_KEY = "fap-sidebar-collapsed";

function subscribeToStorage(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getStoredCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function getServerCollapsed(): boolean {
  return false;
}

export default function AppShell({
  email,
  children,
}: {
  email?: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isAuthenticated = Boolean(email);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsedOverride, setCollapsedOverride] = useState<boolean | null>(null);
  const storedCollapsed = useSyncExternalStore(
    subscribeToStorage,
    getStoredCollapsed,
    getServerCollapsed,
  );
  const collapsed = collapsedOverride ?? storedCollapsed;
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  function toggleCollapsed() {
    const next = !collapsed;
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
    } catch {
      // Ignore storage failures.
    }
    setCollapsedOverride(next);
  }

  async function logout() {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      const res = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { origin: window.location.origin },
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(data?.error?.message ?? "Logout failed.");
      }
      router.push("/login");
      router.refresh();
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : "Logout failed.");
      setLoggingOut(false);
    }
  }

  const sidebarFooter = (compact: boolean) => (
    <div className="mt-auto space-y-3 pt-5">
      {!compact ? (
        <div className="rounded-xl border border-blue-400/20 bg-blue-500/[0.06] p-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-blue-200">
            <ShieldCheck className="h-3.5 w-3.5" />
            Public-access policy
          </div>
          <p className="mt-1.5 text-[11px] leading-5 text-slate-400">
            Keyless public models are limited to the operator&apos;s allowlist. Visitors may add their
            own provider keys; those keys stay encrypted on the server and are never sent to the
            browser. No silent paid fallback.
          </p>
        </div>
      ) : null}
      {isAuthenticated ? (
        <div
          className={cn(
            "rounded-xl border border-white/8 bg-white/[0.025] p-3",
            compact && "flex flex-col items-center p-2",
          )}
        >
          {!compact ? (
            <>
              <p className="truncate text-xs font-medium text-slate-200" title={email ?? undefined}>
                {email}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">Signed-in session</p>
            </>
          ) : (
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-400/15 text-[10px] font-semibold text-blue-200"
              title={email ?? undefined}
            >
              {(email ?? "?").slice(0, 1).toUpperCase()}
            </span>
          )}
          {logoutError ? <p className="mt-2 text-[11px] text-red-300">{logoutError}</p> : null}
          <button
            type="button"
            onClick={logout}
            disabled={loggingOut}
            title="Sign out"
            className={cn(
              "mt-2.5 flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-slate-300 transition hover:bg-white/5 disabled:opacity-50",
              compact && "mt-1.5 w-8 px-0",
            )}
          >
            {!compact ? (loggingOut ? "Signing out…" : "Sign out") : null}
          </button>
        </div>
      ) : (
        <div
          className={cn(
            "rounded-xl border border-white/8 bg-white/[0.025] p-3",
            compact && "flex flex-col items-center p-2",
          )}
          title="Public access — no account required"
        >
          {!compact ? (
            <>
              <p className="text-xs font-medium text-slate-200">Public access</p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                No account required · local history
              </p>
              <Link
                href="/login"
                className="mt-2 inline-flex text-[11px] font-medium text-cyan-300 hover:text-cyan-200"
              >
                Sign in / create account
              </Link>
            </>
          ) : (
            <Link
              href="/login"
              title="Sign in / create account"
              className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-400/15 text-blue-200"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-white/8 bg-[#070d20]/90 px-3 py-5 backdrop-blur-xl transition-[width] duration-200 lg:flex",
          collapsed ? "w-[76px]" : "w-64",
        )}
      >
        <div className={cn("flex items-center", collapsed ? "justify-center" : "justify-between px-1")}>
          <Logo compact={collapsed} />
          {!collapsed ? (
            <button
              type="button"
              onClick={toggleCollapsed}
              className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/5 hover:text-white"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        {collapsed ? (
          <button
            type="button"
            onClick={toggleCollapsed}
            className="mx-auto mt-3 rounded-lg p-1.5 text-slate-500 transition hover:bg-white/5 hover:text-white"
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        ) : null}
        <div className="mt-6 flex-1 overflow-y-auto">
          <NavLinks
            pathname={pathname}
            collapsed={collapsed}
          />
        </div>
        {sidebarFooter(isAuthenticated)}
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative flex h-full w-[290px] flex-col border-r border-white/10 bg-[#070d20] px-4 py-5 shadow-2xl">
            <div className="flex items-center justify-between px-1">
              <Logo />
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white"
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-6 flex-1 overflow-y-auto">
              <NavLinks
                pathname={pathname}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>
            {sidebarFooter(isAuthenticated)}
          </aside>
        </div>
      ) : null}

      <div className={cn("transition-[padding] duration-200", collapsed ? "lg:pl-[76px]" : "lg:pl-64")}>
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/8 bg-[#050915]/85 px-4 py-3 backdrop-blur-xl lg:hidden">
          <Logo />
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-lg border border-white/10 bg-white/5 p-2 text-slate-300"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
        </header>
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-9">
          {children}
        </main>
      </div>
    </div>
  );
}
