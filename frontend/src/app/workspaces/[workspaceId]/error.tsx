"use client";

import { useEffect } from "react";
import { AlertTriangle, FolderOpen, RotateCcw } from "lucide-react";
import Link from "next/link";

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Workspace error:", error);
  }, [error]);

  const isNotFound =
    error.message.includes("404") || error.message.includes("not found");

  return (
    <div className="min-h-[calc(100dvh-7.5rem)] overflow-hidden rounded-2xl border border-zinc-200/80 bg-white">
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50 ring-1 ring-rose-100">
          <AlertTriangle className="h-8 w-8 text-rose-500" />
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-semibold tracking-[-0.02em] text-zinc-900">
            {isNotFound ? "Workspace not found" : "Failed to load workspace"}
          </h2>
          <p className="mt-1 max-w-sm text-sm text-zinc-500">
            {isNotFound
              ? "This workspace may have been deleted or doesn't exist."
              : "An error occurred while loading this workspace. Please try again."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!isNotFound && (
            <button
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
            >
              <RotateCcw className="h-4 w-4" />
              Try Again
            </button>
          )}
          <Link
            href="/workspaces"
            className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-5 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            <FolderOpen className="h-4 w-4" />
            All Workspaces
          </Link>
        </div>
      </div>
    </div>
  );
}
