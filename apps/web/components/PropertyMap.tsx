"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { TransactionType } from "@brookrege/domain";
import { useI18n } from "@/lib/i18n/client";
import { moneyCompact, titleOf } from "@/lib/i18n/format";

export interface Pin { id: string; title: string; titleEn: string | null; price: number; transaction: TransactionType; latitude: number; longitude: number }

const SOHAG: [number, number] = [26.5569, 31.6948];

/**
 * Leaflet map with price-label pins. Leaflet touches `window`, so it is imported
 * lazily inside the effect. Tile provider: swap OSM for a commercial provider
 * (MapTiler/Stadia) before launch — OSM's public tiles are not for production traffic.
 */
export function PropertyMap({ pins, height = "70vh" }: { pins: Pin[]; height?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { locale, t } = useI18n();

  useEffect(() => {
    let map: import("leaflet").Map | undefined;
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled || !ref.current) return;
      map = L.map(ref.current, { scrollWheelZoom: false }).setView(SOHAG, 12);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      const bounds: [number, number][] = [];
      for (const p of pins) {
        const label = `${moneyCompact(p.price, locale)}${p.transaction === "RENT" ? t.common.perMonthShort : ""}`;
        const icon = L.divIcon({
          className: "",
          html: `<span dir="${locale === "ar" ? "rtl" : "ltr"}" style="display:inline-block;white-space:nowrap;background:rgb(var(--palm));color:rgb(var(--on-palm));font:600 12px/1 var(--font-plex),sans-serif;padding:6px 8px;border-radius:6px;box-shadow:0 1px 2px rgba(34,48,44,.3)">${label}</span>`,
          iconSize: undefined,
        });
        const a = document.createElement("a");
        a.href = `/${locale}/properties/${p.id}`;
        a.textContent = titleOf(p, locale);
        L.marker([p.latitude, p.longitude], { icon, title: titleOf(p, locale), keyboard: true }).addTo(map).bindPopup(a);
        bounds.push([p.latitude, p.longitude]);
      }
      if (bounds.length > 1) map.fitBounds(bounds, { padding: [40, 40] });
      else if (bounds.length === 1) map.setView(bounds[0]!, 15);
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [pins, locale, t]);

  return <div ref={ref} style={{ height }} className="w-full rounded-tile border border-reed" aria-label={t.map.aria} role="region" />;
}
