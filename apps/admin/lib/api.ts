"use client";

const BASE = `${process.env.NEXT_PUBLIC_API_URL ?? ""}/api/admin`;

export class ApiError extends Error {
  constructor(public status: number, message: string, public fields?: Record<string, string[]>, public code?: string) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

/** When the last successful API call happened — drives the inactivity warning. */
let lastActivity = Date.now();
export const lastApiActivity = () => lastActivity;

/** Endpoints that must never trigger an automatic token refresh (they ARE the sign-in flow). */
const NO_REFRESH = ["/auth/login", "/auth/refresh", "/auth/logout", "/auth/2fa/verify"];

/** Shown once on the sign-in page after the session ends (e.g. the inactivity timeout). */
export const SIGNIN_NOTICE_KEY = "bk-signin-notice";

export function goToSignIn(message?: string) {
  if (typeof window === "undefined") return;
  try { if (message) sessionStorage.setItem(SIGNIN_NOTICE_KEY, message); } catch { /* private mode */ }
  if (window.location.pathname !== "/login") window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
}

/** One refresh at a time, even if several requests hit 401 together. */
function refreshOnce() {
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: "POST", credentials: "include" })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}, retry = true): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    credentials: "include",
    headers: json !== undefined ? { "Content-Type": "application/json", ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });

  if (res.status === 401 && retry && !NO_REFRESH.includes(path)) {
    if (await refreshOnce()) return api<T>(path, init, false);
    const body = await res.json().catch(() => null);
    goToSignIn(body?.error?.message);
    throw new ApiError(401, body?.error?.message ?? "Your session ended. Sign in again.");
  }
  if (res.status === 204) { lastActivity = Date.now(); return undefined as T; }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const code = body?.error?.code as string | undefined;
    // Mandatory step (new password / 2FA set-up) became required mid-session: ask the layout to show it.
    if (code === "MFA_SETUP_REQUIRED" || code === "PASSWORD_CHANGE_REQUIRED") window.dispatchEvent(new Event("bk:session-changed"));
    throw new ApiError(res.status, body?.error?.message ?? `Request failed (${res.status}).`, body?.error?.details, code);
  }
  lastActivity = Date.now();
  return body as T;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

/**
 * Upload with progress (fetch can't report upload progress). Refreshes the session once on 401.
 * Resolves with the JSON body; per-file problems come back in `errors`, not as an exception.
 */
export function uploadFiles<T>(path: string, files: File[], onProgress: (pct: number) => void, retry = true): Promise<T> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}${path}`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onerror = () => reject(new ApiError(0, "Upload failed. Check your connection and try again."));
    xhr.onload = async () => {
      if (xhr.status === 401 && retry && (await refreshOnce())) return resolve(uploadFiles<T>(path, files, onProgress, false));
      const body = (() => { try { return JSON.parse(xhr.responseText); } catch { return null; } })();
      if (xhr.status >= 400 && !body?.errors) return reject(new ApiError(xhr.status, body?.error?.message ?? `Upload failed (${xhr.status}).`));
      resolve(body as T);
    };
    xhr.send(fd);
  });
}

/** Downloads a generated file (reports). */
export async function download(path: string, json: unknown, filename: string) {
  const res = await fetch(`${BASE}${path}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(json) });
  if (!res.ok) { const b = await res.json().catch(() => null); throw new ApiError(res.status, b?.error?.message ?? "Export failed."); }
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
