"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function CallbackHandler() {
  const searchParams = useSearchParams();
  const code = searchParams.get("code") ?? "";
  const error = searchParams.get("error") ?? "";

  useEffect(() => {
    if (code) {
      localStorage.setItem("gdrive_auth_code", code);
    } else if (error) {
      localStorage.setItem("gdrive_auth_error", error);
    }
    window.close();
  }, [code, error]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-zinc-500">
        Connected! This window will close automatically…
      </p>
    </div>
  );
}

export default function GDriveCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-sm text-zinc-500">Connecting to Google Drive…</p>
        </div>
      }
    >
      <CallbackHandler />
    </Suspense>
  );
}
