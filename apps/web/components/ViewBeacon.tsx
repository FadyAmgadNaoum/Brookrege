"use client";

import { useEffect } from "react";
import { BROWSER_BASE } from "@/lib/api";

/**
 * Counts one view of a listing from the visitor's browser (analytics). Runs after the page is shown, never
 * blocks it, and sends nothing but the listing id. The API ignores bots and repeat views.
 */
export function ViewBeacon({ id }: { id: string }) {
  useEffect(() => {
    const url = `${BROWSER_BASE}/api/properties/${encodeURIComponent(id)}/view`;
    try {
      if (!navigator.sendBeacon?.(url)) void fetch(url, { method: "POST", keepalive: true }).catch(() => undefined);
    } catch {
      /* analytics must never break the page */
    }
  }, [id]);
  return null;
}
