"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Permission, Restriction, Role } from "@brookrege/domain";
import { api, goToSignIn, lastApiActivity } from "./api";

export interface Session {
  user: { id: string; name: string; email: string; role: Role };
  permissions: Permission[];
  restriction: Restriction;
  security: { passwordChangedAt: string | null; sessionIdleMinutes: number };
}

const Ctx = createContext<(Session & { reload: () => Promise<void> }) | null>(null);

export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const reload = useCallback(async () => {
    try { setSession(await api<Session>("/auth/me")); } catch { /* 401 → api() sends the browser to /login */ }
  }, []);
  useEffect(() => {
    void reload();
    const onChange = () => void reload();
    window.addEventListener("bk:session-changed", onChange);
    return () => window.removeEventListener("bk:session-changed", onChange);
  }, [reload]);
  if (!session) return <>{fallback}</>;
  return <Ctx.Provider value={{ ...session, reload }}>{children}<IdleWarning minutes={session.security.sessionIdleMinutes} /></Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return { ...s, can: (p: Permission) => s.permissions.includes(p) };
}

/**
 * The server ends a session after `minutes` without activity. Five minutes before that, offer to
 * stay signed in; if nobody answers, go to the sign-in page with an explanation.
 */
function IdleWarning({ minutes }: { minutes: number }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const t = setInterval(() => {
      const idleMs = Date.now() - lastApiActivity();
      const remaining = minutes * 60_000 - idleMs;
      if (remaining <= 0) goToSignIn(`You were signed out after ${minutes} minutes without activity.`);
      else setLeft(remaining <= 5 * 60_000 ? Math.ceil(remaining / 60_000) : null);
    }, 15_000);
    return () => clearInterval(t);
  }, [minutes]);
  if (left === null) return null;
  return (
    <div role="alertdialog" aria-live="assertive" className="fixed inset-x-0 bottom-0 z-50 border-t border-amber-300 bg-amber-50 px-5 py-3 text-sm text-amber-900 print:hidden">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
        <p>For security, you'll be signed out in about {left} minute{left === 1 ? "" : "s"} because there's been no activity.</p>
        <button className="btn-primary" onClick={() => { void api("/auth/me").then(() => setLeft(null)); }}>Stay signed in</button>
      </div>
    </div>
  );
}
