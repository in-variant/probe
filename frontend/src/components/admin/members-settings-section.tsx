"use client";

import { useEffect, useState } from "react";
import { Users } from "lucide-react";

import { deleteMember, listMembers, updateMemberRole, type MemberRole, type MemberRoleRecord } from "@/lib/api";

const PRIMARY_ADMIN_EMAIL = "founders@invariant-ai.com";

export function MembersSettingsSection() {
  const [members, setMembers] = useState<MemberRoleRecord[]>([]);
  const [roles, setRoles] = useState<MemberRole[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("CLIENT");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function refreshMembers() {
    setBusy(true);
    setStatus("");
    try {
      const data = await listMembers();
      setMembers(data.members);
      setRoles(data.roles);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load members");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    queueMicrotask(() => void refreshMembers());
  }, []);

  async function saveMember(targetEmail = email, targetRole = role) {
    if (!targetEmail.trim()) return;
    setBusy(true);
    setStatus("");
    try {
      await updateMemberRole(targetEmail.trim(), targetRole);
      setEmail("");
      setRole("CLIENT");
      await refreshMembers();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to update member");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(targetEmail: string) {
    if (!window.confirm(`Delete ${targetEmail}? This removes them from roles.json.`)) return;
    setBusy(true);
    setStatus("");
    try {
      await deleteMember(targetEmail);
      await refreshMembers();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to delete member");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-zinc-900 text-white">
            <Users className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Members</h2>
            <p className="text-sm text-zinc-500">Assign roles for authorized Probe users.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refreshMembers()}
          disabled={busy}
          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
        >
          {busy ? "Working..." : "Refresh"}
        </button>
      </div>

      <div className="rounded-xl border border-zinc-100 bg-zinc-50/50 p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="member@example.com"
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
          />
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as MemberRole)}
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
          >
            {(roles.length ? roles : ["CLIENT", "INVARIANT", "ADMIN"]).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void saveMember()}
            disabled={busy || !email.trim()}
            className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            Add or update
          </button>
        </div>
        {status && <p className="mt-3 text-sm text-red-600">{status}</p>}
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-zinc-100">
        <div className="border-b border-zinc-100 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500">
          Authorized members
        </div>
        <div className="divide-y divide-zinc-100 bg-white">
          {members.map((member) => (
            <div key={member.email} className="grid items-center gap-3 px-4 py-3 md:grid-cols-[1fr_180px_auto_auto]">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-900">{member.email}</p>
                <p className="text-xs text-zinc-400">
                  {member.updated_at ? `Updated ${new Date(member.updated_at).toLocaleString()}` : "Seeded member"}
                </p>
              </div>
              <select
                value={member.role}
                disabled={busy || member.email === PRIMARY_ADMIN_EMAIL}
                onChange={(event) => void saveMember(member.email, event.target.value as MemberRole)}
                className="rounded-xl border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 disabled:bg-zinc-50 disabled:text-zinc-400"
              >
                {(roles.length ? roles : ["CLIENT", "INVARIANT", "ADMIN"]).map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                {member.allowed ? "Allowed" : "Disabled"}
              </span>
              <button
                type="button"
                disabled={busy || member.email === PRIMARY_ADMIN_EMAIL}
                onClick={() => void removeMember(member.email)}
                className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-40"
              >
                Delete
              </button>
            </div>
          ))}
          {members.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-zinc-500">No members have been configured yet.</div>
          )}
        </div>
      </div>
    </section>
  );
}
