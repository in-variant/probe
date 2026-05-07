import Link from "next/link";
import { FolderOpen } from "lucide-react";

export default function HomePage() {
  return (
    <div className="min-h-[calc(100dvh-7.5rem)] overflow-hidden rounded-2xl border border-zinc-200/80 bg-white">
      <div className="flex flex-col items-center justify-center gap-6 py-20">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 ring-1 ring-blue-100">
          <FolderOpen className="h-8 w-8 text-blue-600" />
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-semibold tracking-[-0.02em] text-zinc-900">
            Welcome to Probe
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Your document management workspace is ready.
          </p>
        </div>
        <Link
          href="/workspaces"
          className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          Go to Workspaces
        </Link>
      </div>
    </div>
  );
}
