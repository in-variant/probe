import Link from "next/link";
import { ArrowRight, FolderOpen, Sparkles } from "lucide-react";

export default function HomePage() {
  return (
    <div className="relative mb-14 min-h-[calc(100dvh-7.5rem)] overflow-hidden rounded-2xl border border-zinc-200/80 bg-gradient-to-b from-white via-zinc-50 to-zinc-100 lg:mb-0">
      <div className="pointer-events-none absolute -left-20 top-8 h-64 w-64 rounded-full bg-violet-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-72 w-72 rounded-full bg-sky-200/50 blur-3xl" />

      <div className="relative mx-auto flex min-h-[calc(100dvh-7.5rem)] max-w-5xl flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white/80 px-3 py-1 text-xs font-medium text-zinc-600 backdrop-blur">
          <Sparkles className="h-3.5 w-3.5 text-violet-500" />
          Invariant Probe Workspace
        </div>

        <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.03em] text-zinc-900 sm:text-5xl">
          Review and ship documents with a cleaner command center.
        </h1>

        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-zinc-600 sm:text-base">
          Keep workspaces organized, collaborate on requests, and move faster with a polished workflow that feels focused.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/workspaces"
            className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
          >
            <FolderOpen className="h-4 w-4" />
            Go to Workspaces
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
