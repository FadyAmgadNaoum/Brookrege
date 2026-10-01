"use client";

import { useState, type FormEvent } from "react";
import { ROLES, type Role } from "@brookrege/domain";
import { ErrorNote, Loading, PageHeader } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { fmtDate } from "@/lib/labels";
import { useSession } from "@/lib/session";
import { useFetch } from "@/lib/useFetch";

interface Member { id: string; email: string; name: string; role: Role; status: "ACTIVE" | "SUSPENDED"; lastLoginAt: string | null; lockedUntil: string | null; mustChangePassword: boolean }
const ROLE_LABEL: Record<Role, string> = { SUPER_ADMIN: "Super admin", CONTENT_ADMIN: "Content admin", MODERATOR: "Moderator" };
const ROLE_HELP: Record<Role, string> = {
  SUPER_ADMIN: "Everything, including team and activity log",
  CONTENT_ADMIN: "Listings, photos, compounds, leads — no team or system settings",
  MODERATOR: "View listings, renew or take them offline, handle inquiries — no editing or deleting",
};

export default function TeamPage() {
  const me = useSession().user;
  const { data, error, loading, reload } = useFetch<{ data: Member[] }>("/team");
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setErr(null);
    try {
      await api("/team", { method: "POST", json: Object.fromEntries(fd) });
      form.reset();
      setNotice("Team member added. Give them the temporary password in person or by phone — never by email or chat. They'll choose their own at first sign-in.");
      await reload();
    } catch (x) {
      setErr(errorText(x));
    }
  }

  async function patch(id: string, body: Partial<Member>) {
    setErr(null);
    try {
      await api(`/team/${id}`, { method: "PATCH", json: body });
      await reload();
    } catch (x) {
      setErr(errorText(x));
    }
  }

  return (
    <>
      <PageHeader title="Team">Changing someone&apos;s role or suspending them signs them out everywhere.</PageHeader>
      {notice && <p role="status" className="mb-4 rounded-md border border-palm/30 bg-palm-tint px-4 py-3 text-palm-dark">{notice}</p>}
      <ErrorNote message={err} />
      <form onSubmit={create} className="panel mb-6 grid gap-3 p-4 md:grid-cols-5">
        <div><label className="label" htmlFor="t-name">Name</label><input id="t-name" name="name" required className="field" /></div>
        <div><label className="label" htmlFor="t-email">Email</label><input id="t-email" name="email" type="email" required className="field" /></div>
        <div><label className="label" htmlFor="t-role">Role</label>
          <select id="t-role" name="role" defaultValue="CONTENT_ADMIN" className="field">{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
        </div>
        <div><label className="label" htmlFor="t-pw">Temporary password</label><input id="t-pw" name="password" type="text" required minLength={12} autoComplete="new-password" className="field" /></div>
        <div className="flex items-end"><button className="btn-primary w-full">Add member</button></div>
        <p className="text-xs text-silt-soft md:col-span-5">Temporary password: 12+ characters with upper and lower case letters, a number and a symbol, and not a common word. The person replaces it at first sign-in. Unlocking and sign-outs are on the Security page.</p>
      </form>
      {loading ? <Loading /> : error ? <ErrorNote message={error} /> : (
        <div className="panel overflow-x-auto"><table className="w-full min-w-[820px]">
          <thead><tr><th className="th">Member</th><th className="th">Role</th><th className="th">Last sign-in</th><th className="th">Access</th></tr></thead>
          <tbody>{data?.data.map((m) => (
            <tr key={m.id}>
              <td className="td"><p className="font-medium">{m.name}{m.id === me.id && <span className="text-silt-soft"> (you)</span>}</p><p className="text-xs text-silt-soft">{m.email}</p></td>
              <td className="td">
                <select aria-label={`Role for ${m.name}`} value={m.role} onChange={(e) => patch(m.id, { role: e.target.value as Role })} className="field w-44">
                  {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
                <p className="mt-1 max-w-xs text-xs text-silt-soft">{ROLE_HELP[m.role]}</p>
              </td>
              <td className="td">{fmtDate(m.lastLoginAt)}{m.mustChangePassword && <p className="text-xs text-amber-700">Hasn't chosen a password yet</p>}{m.lockedUntil && new Date(m.lockedUntil) > new Date() && <p className="text-xs text-red-700">Locked</p>}</td>
              <td className="td">
                {m.status === "ACTIVE"
                  ? <button disabled={m.id === me.id} onClick={() => confirm(`Suspend ${m.name}? They will be signed out immediately.`) && patch(m.id, { status: "SUSPENDED" })} className="btn-danger">Suspend</button>
                  : <button onClick={() => patch(m.id, { status: "ACTIVE" })} className="btn-quiet">Restore access</button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}
