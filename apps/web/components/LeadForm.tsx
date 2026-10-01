"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { BROWSER_BASE } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string; fields: string[] };

/**
 * Shared submit logic for the inquiry and "add your property" forms.
 * API errors are in English, so fields are mapped to messages in the visitor's language.
 */
export function LeadForm({ endpoint, extra = {}, submitLabel, successTitle, successBody, children }: {
  endpoint: "/inquiries" | "/submissions";
  extra?: Record<string, string>;
  submitLabel: string;
  successTitle: string;
  successBody: string;
  children: (fieldError: (name: string) => ReactNode) => ReactNode;
}) {
  const { locale, t } = useI18n();
  const [state, setState] = useState<State>({ kind: "idle" });

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({ kind: "sending" });
    const body: Record<string, string> = { ...extra, locale }; // SMS confirmation in the visitor's language
    new FormData(e.currentTarget).forEach((v, k) => {
      const s = String(v).trim();
      if (s || k === "website") body[k] = s;
    });
    try {
      const res = await fetch(`${BROWSER_BASE}/api${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) return setState({ kind: "sent" });
      const json = await res.json().catch(() => null);
      const fields = Object.keys(json?.error?.details ?? {});
      const message = res.status === 429 ? t.forms.rateLimited : fields.length ? t.forms.checkFields : t.forms.generic;
      setState({ kind: "error", message, fields });
    } catch {
      setState({ kind: "error", message: t.forms.network, fields: [] });
    }
  }

  if (state.kind === "sent") {
    return (
      <div role="status" className="intro rounded-tile border border-palm/40 bg-palm-tint p-5">
        <p className="font-medium text-palm-dark">{successTitle}</p>
        <p className="mt-1 text-sm text-silt">{successBody}</p>
      </div>
    );
  }

  const fieldError = (name: string) =>
    state.kind === "error" && state.fields.includes(name) ? <p className="mt-1 text-xs text-red-600 dark:text-red-400">{t.forms.errors[name] ?? t.forms.generic}</p> : null;

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {children(fieldError)}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" defaultValue="" />
      {state.kind === "error" && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{state.message}</p>}
      <button type="submit" disabled={state.kind === "sending"} className="btn-primary w-full">
        {state.kind === "sending" ? t.forms.sending : submitLabel}
      </button>
      <p className="text-center text-xs text-silt-soft">
        {t.forms.privacyNote}{" "}
        <Link href={`/${locale}/privacy`} className="underline underline-offset-2 hover:text-silt">{t.forms.privacyLink}</Link>
      </p>
    </form>
  );
}
