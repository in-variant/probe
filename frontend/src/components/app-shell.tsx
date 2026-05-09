"use client";

import { useRef, useState, useEffect } from "react";
import {
  FolderOpen,
  Home,
  LogOut,
  ChevronDown,
  User,
  FilePenLine,
  Settings,
  Inbox,
  MapPinned,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { ProbeLogo } from "@/components/probe-logo";
import { useAuth } from "@/lib/auth";

const NAV_ITEMS = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/workspaces", icon: FolderOpen, label: "Workspaces" },
  { href: "/document-editor", icon: FilePenLine, label: "Document Editor" },
  { href: "/requests", icon: Inbox, label: "Requests" },
] as const;

const COMPLIANCE_NAV = {
  href: "/compliance-roadmap",
  icon: MapPinned,
  label: "Compliance roadmap",
} as const;

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="paper-grain flex h-dvh items-center justify-center bg-background">
      <div className="w-full max-w-sm px-6">
        <div className="flex flex-col items-center text-center">
          <ProbeLogo size="lg" />
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

function UserDropdown() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (!user) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-zinc-100"
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
        <ChevronDown className={cn("h-3.5 w-3.5 text-zinc-400 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg animate-slide-down">
          <div className="border-b border-zinc-100 px-4 py-3">
            <p className="truncate text-sm font-medium text-zinc-900">{user.name}</p>
            <p className="truncate text-xs text-zinc-400">{user.email}</p>
          </div>
          <button
            onClick={() => {
              setOpen(false);
              router.push("/profile");
            }}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
          >
            <User className="h-4 w-4" />
            Profile
          </button>
          {user.role === "ADMIN" && (
            <button
              onClick={() => {
                setOpen(false);
                router.push("/admin/settings");
              }}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
            >
              <Settings className="h-4 w-4" />
              Settings
            </button>
          )}
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
      )}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading, login } = useAuth();

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

  const showComplianceNav =
    user.role === "INVARIANT" || user.role === "ADMIN";

  const navEntries = [
    ...NAV_ITEMS,
    ...(showComplianceNav ? [COMPLIANCE_NAV] : []),
  ];

  return (
    <div className="paper-grain flex h-dvh flex-col overflow-hidden bg-background">
      {/* Top navbar */}
      <header className="z-20 border-b border-zinc-200/70 bg-white/90 backdrop-blur-sm">
        <div className="flex h-14 items-center gap-6 px-4 md:px-6 lg:px-8">
          {/* Logo */}
          <Link href="/" className="shrink-0">
            <ProbeLogo />
          </Link>

          {/* Nav links */}
          <nav className="flex items-center gap-1">
            {navEntries.map((item) => {
              const Icon = item.icon;
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Spacer */}
          <div className="flex-1" />

          {/* User dropdown */}
          <UserDropdown />
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 md:px-6 md:py-5 lg:px-8">
        {children}
      </main>
    </div>
  );
}
