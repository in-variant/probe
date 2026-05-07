"use client";

import { useState } from "react";
import { FolderOpen, Home, Menu, Settings, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ProbeLogo } from "@/components/probe-logo";

const NAV_ITEMS = [
  { href: "/", icon: Home, label: "Home" },
  { href: "/workspaces", icon: FolderOpen, label: "Workspaces" },
] as const;

const BOTTOM_NAV = [
  { href: "/settings", icon: Settings, label: "Settings" },
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

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const pageTitle = (() => {
    if (pathname === "/") return "Home";
    if (pathname.startsWith("/workspaces")) return "Workspaces";
    if (pathname.startsWith("/settings")) return "Settings";
    return "Dashboard";
  })();

  return (
    <div className="paper-grain h-dvh overflow-hidden bg-background">
      <div className="flex h-full w-full">
        {/* Desktop sidebar */}
        <aside className="hidden w-72 shrink-0 border-r border-zinc-200/70 bg-white/90 px-4 py-6 backdrop-blur-sm lg:block">
          <Link href="/" className="mb-10 block px-3">
            <ProbeLogo />
          </Link>
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.href} {...item} />
            ))}
          </nav>
          <div className="mt-auto pt-6 border-t border-zinc-200/70 mt-8">
            {BOTTOM_NAV.map((item) => (
              <NavLink key={item.href} {...item} />
            ))}
          </div>
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
            className="h-full w-72 bg-white px-4 py-6 shadow-xl animate-slide-in-left"
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
            <div className="mt-8 border-t border-zinc-200/70 pt-6">
              {BOTTOM_NAV.map((item) => (
                <NavLink key={item.href} {...item} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 px-2 py-2 backdrop-blur lg:hidden">
        <div className="grid grid-cols-3 gap-1">
          {[...NAV_ITEMS, ...BOTTOM_NAV].map((item) => {
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
