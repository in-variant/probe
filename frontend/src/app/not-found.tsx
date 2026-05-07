import { FileQuestion } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mb-14 min-h-[calc(100dvh-7.5rem)] overflow-hidden rounded-2xl border border-zinc-200/80 bg-white lg:mb-0">
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-100 ring-1 ring-zinc-200">
          <FileQuestion className="h-8 w-8 text-zinc-400" />
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-semibold tracking-[-0.02em] text-zinc-900">
            Page not found
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          Back to Home
        </Link>
      </div>
    </div>
  );
}
