"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Permission } from "@brookrege/domain";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

const items: { href: string; label: string; perm: Permission }[] = [
  { href: "/", label: "Overview", perm: "property:read" },
  { href: "/properties", label: "Listings", perm: "property:read" },
  { href: "/inquiries", label: "Inquiries", perm: "inquiry:read" },
  { href: "/submissions", label: "Property submissions", perm: "submission:read" },
  { href: "/media", label: "Media library", perm: "media:read" },
  { href: "/analytics", label: "Analytics & reports", perm: "analytics:read" },
  { href: "/catalog", label: "Regions, compounds & projects", perm: "property:read" },
  { href: "/team", label: "Team", perm: "team:manage" },
  { href: "/notifications", label: "Notifications", perm: "notifications:manage" },
  { href: "/security", label: "Security", perm: "security:manage" },
  { href: "/privacy", label: "Privacy", perm: "privacy:manage" },
  { href: "/account", label: "My account", perm: "property:read" },
  { href: "/audit", label: "Activity log", perm: "audit:read" },
];

export function Sidebar() {
  const { user, can } = useSession();
  const path = usePathname();
  const router = useRouter();

  async function signOut() {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
  }

  return (
    <aside className="flex w-full flex-col bg-ink text-white md:h-screen md:w-64">
      <div className="px-5 py-5">
        <p className="wordmark leading-none">Brookrege</p>
        <p className="mt-1.5 text-[0.625rem] uppercase tracking-[0.32em] text-gold">Admin</p>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:overflow-visible">
        {items.filter((i) => can(i.perm)).map((i) => {
          const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
          return (
            <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined} className={`whitespace-nowrap rounded-[3px] border-s-2 px-3 py-2 transition-colors ${active ? "border-gold bg-white/10 font-medium text-white" : "border-transparent text-white/60 hover:bg-white/5 hover:text-white"}`}>
              {i.label}
            </Link>
          );
        })}
      </nav>
      <div className="hidden border-t border-white/10 px-5 py-4 md:block">
        <Link href="/account" className="font-medium hover:text-gold">{user.name}</Link>
        <p className="text-xs text-white/50">{user.role.replace("_", " ").toLowerCase()}</p>
        <button onClick={signOut} className="mt-2 text-xs text-gold hover:underline">Sign out</button>
      </div>
    </aside>
  );
}
