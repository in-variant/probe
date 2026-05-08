"use client";

import { useState } from "react";
import { FolderOpen, Home, LogOut, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ProbeLogo } from "@/components/probe-logo";
import { useAuth } from "@/lib/auth";

const NAV_ITEMS = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/workspaces", icon: FolderOpen, label: "Workspaces" },
] as const;

function NavLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
        "hover:bg-zinc-100/80 hover:text-zinc-900",
        active && "bg-zinc-900 text-white hover:bg-zinc-900 hover:text-white",
        !active && "text-zinc-600",
      )}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </Link>
  );
}

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="paper-grain flex h-dvh items-center justify-center bg-background">
      <div className="w-full max-w-sm px-6">
        <div className="text-center">
          <ProbeLogo />
          <p className="mt-4 text-sm text-zinc-500">
            Sign in to access your workspaces
          </p>
        </div>
        <button
          onClick={onLogin}
          className="mt-8 flex w-full items-center justify-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100"
        >
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Sign in with Google
        </button>
        <p className="mt-6 text-center text-xs text-zinc-400">
          Restricted to authorized email domains
        </p>
      </div>
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  return (
    <div className="relative mt-auto border-t border-zinc-200/70 pt-4">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-zinc-100/80"
      >
        {user.picture ? (
          <img
            src={user.picture}
            alt=""
            className="h-8 w-8 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="grid h-8 w-8 place-items-center rounded-full bg-blue-100 text-xs font-medium text-blue-700">
            {user.name?.[0] || user.email[0]}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-800">
            {user.name || user.email}
          </p>
          <p className="truncate text-xs text-zinc-400">{user.email}</p>
        </div>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-2 right-2 z-40 mb-1 rounded-xl border border-zinc-200 bg-white py-1 shadow-lg">
            <button
              onClick={() => {
                setOpen(false);
                logout();
              }}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { user, loading, login } = useAuth();

  // Allow callback pages to render without auth
  if (pathname.startsWith("/auth/callback") || pathname.startsWith("/gdrive/callback")) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={login} />;
  }

  const pageTitle = (() => {
    if (pathname === "/") return "Home";
    if (pathname.startsWith("/workspaces")) return "Workspaces";
    return "Dashboard";
  })();

  return (
    <div className="paper-grain h-dvh overflow-hidden bg-background">
      <div className="flex h-full w-full">
        {/* Desktop sidebar */}
        <aside className="hidden w-72 shrink-0 flex-col border-r border-zinc-200/70 bg-white/90 px-4 py-6 backdrop-blur-sm lg:flex">
          <Link href="/" className="mb-10 block px-3">
            <ProbeLogo />
          </Link>
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.href} {...item} />
            ))}
          </nav>
          <UserMenu />
        </aside>

        <div className="flex h-full flex-1 flex-col overflow-hidden">
          {/* Mobile-only topbar (hamburger) */}
          <header className="sticky top-0 z-20 border-b border-zinc-200/70 bg-background/90 px-4 py-3 backdrop-blur lg:hidden">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setMobileSidebarOpen(true)}
                className="rounded-xl border border-zinc-200/80 bg-white p-2 text-zinc-600"
              >
                <Menu className="h-4 w-4" />
              </button>
              <h2 className="text-sm font-medium text-zinc-600">{pageTitle}</h2>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 md:px-6 md:py-5 lg:px-8">
            {children}
          </main>
        </div>
      </div>

      {/* Mobile sidebar overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/35 lg:hidden animate-fade-in"
          onClick={() => setMobileSidebarOpen(false)}
        >
          <div
            className="flex h-full w-72 flex-col bg-white px-4 py-6 shadow-xl animate-slide-in-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-8 flex items-center justify-between px-3">
              <ProbeLogo />
              <button
                onClick={() => setMobileSidebarOpen(false)}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="space-y-1">
              {NAV_ITEMS.map((item) => (
                <NavLink key={item.href} {...item} />
              ))}
            </nav>
            <UserMenu />
          </div>
        </div>
      )}

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 px-2 py-2 backdrop-blur lg:hidden">
        <div className="grid grid-cols-2 gap-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center rounded-lg py-1 text-[10px] text-zinc-500",
                  active && "bg-zinc-900 text-white",
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
