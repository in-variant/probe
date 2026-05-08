"use client";

import { useAuth } from "@/lib/auth";
import { LogOut, Mail, Shield, User } from "lucide-react";

export default function ProfilePage() {
  const { user, logout } = useAuth();

  if (!user) return null;

  const domain = user.email.split("@")[1];

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-medium text-zinc-900">Profile</h1>
      <p className="mt-1 text-sm text-zinc-500">Your account details</p>

      <div className="mt-8 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        {/* Avatar + name header */}
        <div className="flex items-center gap-5 border-b border-zinc-100 px-6 py-6">
          {user.picture ? (
            <img
              src={user.picture}
              alt=""
              className="h-16 w-16 rounded-full ring-2 ring-zinc-100"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="grid h-16 w-16 place-items-center rounded-full bg-blue-100 text-xl font-semibold text-blue-700 ring-2 ring-blue-50">
              {user.name?.[0] || user.email[0]}
            </div>
          )}
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-zinc-900">
              {user.name || "User"}
            </h2>
            <p className="truncate text-sm text-zinc-500">{user.email}</p>
          </div>
        </div>

        {/* Info rows */}
        <div className="divide-y divide-zinc-100">
          <div className="flex items-center gap-4 px-6 py-4">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-500">
              <User className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-zinc-400">Full Name</p>
              <p className="truncate text-sm font-medium text-zinc-800">
                {user.name || "—"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 px-6 py-4">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-500">
              <Mail className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-zinc-400">Email</p>
              <p className="truncate text-sm font-medium text-zinc-800">
                {user.email}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 px-6 py-4">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-500">
              <Shield className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-zinc-400">Organization</p>
              <p className="truncate text-sm font-medium text-zinc-800">
                @{domain}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Sign out */}
      <div className="mt-6">
        <button
          onClick={logout}
          className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-600 shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </div>
  );
}
