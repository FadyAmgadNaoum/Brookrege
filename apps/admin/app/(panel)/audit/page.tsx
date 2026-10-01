"use client";

import { useState } from "react";
import { Empty, ErrorNote, Loading, PageHeader, Pager } from "@/components/ui";
import { fmtDateTime } from "@/lib/labels";
import { useFetch } from "@/lib/useFetch";

interface Entry { id: string; action: string; entityType: string; entityId: string | null; before: unknown; after: unknown; ip: string | null; createdAt: string; actor: { name: string; email: string } | null }

const ACTION_TEXT: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.login_failed": "Failed sign-in attempt",
  "auth.mfa_failed": "Wrong two-step code",
  "auth.password_check_failed": "Wrong current password (password change)",
  "auth.locked": "Account locked after failed attempts",
  "auth.password_changed": "Changed password",
  "auth.2fa_enabled": "Turned on two-step verification",
  "auth.2fa_disabled": "Turned off two-step verification",
  "auth.backup_code_used": "Signed in with a backup code",
  "auth.session_revoked": "Signed out a browser",
  "security.ip_blocked": "Blocked: address not allowed",
  "security.ip_allowlist_update": "Changed allowed networks",
  "security.policy_update": "Changed security policy",
  "team.2fa_reset": "Reset two-step verification",
  "security.revoke_all_sessions": "Signed out all staff (emergency)",
  "privacy.export": "Exported a person's data",
  "privacy.erase": "Erased a person's data",
  "privacy.retention": "Nightly clean-up of old personal data",
  "privacy.retention_manual": "Ran the personal-data clean-up",
  "privacy.policy_update": "Changed how long personal data is kept",
  "team.unlock": "Unlocked an account",
  "property.create": "Created listing",
  "property.update": "Edited listing",
  "property.publish": "Published listing",
  "property.renew": "Renewed listing",
  "property.expire": "Took listing offline",
  "property.auto_expire": "Listings expired automatically",
  "property.mark_sold": "Marked listing as sold",
  "property.archive": "Archived listing",
  "property.unpublish": "Moved listing to drafts",
  "property.delete": "Deleted listing",
  "property.media_upload": "Uploaded photos",
  "property.media_delete": "Deleted a photo",
  "inquiry.update": "Updated inquiry",
  "submission.update": "Updated submission",
  "team.create": "Added team member",
  "team.update": "Changed team member",
  "team.update_with_password": "Changed team member and reset password",
};

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const { data, error, loading } = useFetch<{ data: Entry[]; meta: { pageCount: number } }>(`/audit?page=${page}${category ? `&action=${category}` : ""}`);
  return (
    <>
      <PageHeader title="Activity log">Every change made in the admin, who made it, and when. Entries can&apos;t be edited or deleted.</PageHeader>
      <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} className="field mb-4 w-64" aria-label="Show">
        <option value="">Everything</option>
        <option value="auth.">Sign-ins and passwords</option>
        <option value="security.">Security settings</option>
        <option value="team.">Team changes</option>
        <option value="property.">Listings</option>
        <option value="media.">Photos and videos</option>
        <option value="inquiry.">Inquiries</option>
        <option value="privacy.">Privacy requests</option>
      </select>
      {loading ? <Loading /> : error ? <ErrorNote message={error} /> : !data?.data.length ? <Empty>No activity yet.</Empty> : (
        <div className="panel overflow-x-auto"><table className="w-full min-w-[720px]">
          <thead><tr><th className="th">When</th><th className="th">Who</th><th className="th">What</th><th className="th">Details</th></tr></thead>
          <tbody>{data.data.map((e) => (
            <tr key={e.id}>
              <td className="td whitespace-nowrap">{fmtDateTime(e.createdAt)}</td>
              <td className="td">{e.actor?.name ?? "System"}<p className="text-xs text-silt-soft">{e.ip}</p></td>
              <td className="td">{ACTION_TEXT[e.action] ?? e.action}<p className="text-xs text-silt-soft">{e.entityType} {e.entityId}</p></td>
              <td className="td">
                {(e.before != null || e.after != null) && (
                  <button onClick={() => setOpen(open === e.id ? null : e.id)} className="text-palm hover:underline" aria-expanded={open === e.id}>
                    {open === e.id ? "Hide changes" : "Show changes"}
                  </button>
                )}
                {open === e.id && (
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    {e.before != null && <pre className="max-h-64 overflow-auto rounded bg-limestone p-2 text-xs">{JSON.stringify(e.before, null, 2)}</pre>}
                    {e.after != null && <pre className="max-h-64 overflow-auto rounded bg-palm-tint/60 p-2 text-xs">{JSON.stringify(e.after, null, 2)}</pre>}
                  </div>
                )}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <Pager page={page} pageCount={data?.meta.pageCount ?? 1} onPage={setPage} />
    </>
  );
}
