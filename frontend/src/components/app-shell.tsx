"use client";

import { Home, Search, Settings } from "lucide-react";
import Link from "next/link";

const NOISE_SVG = `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

function NavItem({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100"
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="relative w-72 shrink-0 border-r border-gray-200 bg-white/90 backdrop-blur-sm">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.02]"
          style={{ backgroundImage: NOISE_SVG }}
        />
        <div className="relative flex h-full flex-col">
          <div className="flex h-14 items-center border-b border-gray-200 px-6">
            <span className="text-base font-semibold tracking-tight">
              Probe
            </span>
          </div>
          <nav className="flex-1 space-y-1 p-3">
            <NavItem href="/" icon={Home} label="Home" />
            <NavItem href="/search" icon={Search} label="Search" />
            <NavItem href="/settings" icon={Settings} label="Settings" />
          </nav>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Topbar */}
        <header className="relative h-14 shrink-0 border-b border-gray-200 bg-white/90 backdrop-blur-sm">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.02]"
            style={{ backgroundImage: NOISE_SVG }}
          />
          <div className="relative flex h-full items-center px-6">
            <h1 className="text-sm font-medium text-gray-600">Dashboard</h1>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
