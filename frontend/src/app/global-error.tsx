"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex h-dvh items-center justify-center bg-zinc-50 font-sans antialiased">
        <div className="mx-auto max-w-md px-6 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50 ring-1 ring-rose-100">
            <svg
              className="h-8 w-8 text-rose-500"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            An unexpected error occurred. Please try again or refresh the page.
          </p>
          {error.digest && (
            <p className="mt-3 font-mono text-xs text-zinc-400">
              Error ID: {error.digest}
            </p>
          )}
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              onClick={reset}
              className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800"
            >
              Try Again
            </button>
            <button
              onClick={() => (window.location.href = "/")}
              className="rounded-full border border-zinc-200 bg-white px-5 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
            >
              Go Home
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
