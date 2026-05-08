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
      localStorage.setItem("auth_callback_code", code);
    } else if (error) {
      localStorage.setItem("auth_callback_error", error);
    }
    window.close();
  }, [code, error]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-zinc-500">
        Signing in… This window will close automatically.
      </p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-sm text-zinc-500">Signing in…</p>
        </div>
      }
    >
      <CallbackHandler />
    </Suspense>
  );
}
