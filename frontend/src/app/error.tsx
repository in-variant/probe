"use client";

import { useEffect } from "react";
import { AlertTriangle, Home, RotateCcw } from "lucide-react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Page error:", error);
  }, [error]);

  return (
    <div className="min-h-[calc(100dvh-7.5rem)] overflow-hidden rounded-2xl border border-zinc-200/80 bg-white">
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50 ring-1 ring-rose-100">
          <AlertTriangle className="h-8 w-8 text-rose-500" />
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-semibold tracking-[-0.02em] text-zinc-900">
            Something went wrong
          </h2>
          <p className="mt-1 max-w-sm text-sm text-zinc-500">
            An error occurred while loading this page. Please try again.
          </p>
          {error.digest && (
            <p className="mt-2 font-mono text-xs text-zinc-400">
              Error ID: {error.digest}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
          >
            <RotateCcw className="h-4 w-4" />
            Try Again
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-5 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            <Home className="h-4 w-4" />
            Go Home
          </Link>
        </div>
      </div>
    </div>
  );
}
