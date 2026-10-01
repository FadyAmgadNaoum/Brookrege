"use client";

import { Sidebar } from "@/components/Sidebar";
import { Loading } from "@/components/ui";
import { PasswordForm } from "@/components/security/PasswordForm";
import { api } from "@/lib/api";
import { SessionProvider, useSession } from "@/lib/session";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider fallback={<Loading />}>
      <Gate>
        <div className="md:flex">
          <Sidebar />
          <main className="min-w-0 flex-1 p-5 md:h-screen md:overflow-y-auto md:p-8">{children}</main>
        </div>
      </Gate>
    </SessionProvider>
  );
}

/** Replacing a temporary password comes before everything else; the menu isn't shown until it's done. */
function Gate({ children }: { children: React.ReactNode }) {
  const { restriction, user, reload } = useSession();
  if (restriction === "NONE") return <>{children}</>;
  const signOut = async () => { await api("/auth/logout", { method: "POST" }).catch(() => undefined); window.location.href = "/login"; };
  return (
    <main className="mx-auto max-w-3xl p-6 md:p-10">
      <div className="mb-8 flex items-center justify-between">
        <p className="wordmark">Brookrege <span className="text-xs tracking-[0.32em] text-sandstone">Admin</span></p>
        <button onClick={signOut} className="text-sm text-palm hover:underline">Sign out</button>
      </div>
      <div className="panel p-6">
        <h1 className="mb-1 text-lg font-semibold">Choose your own password</h1>
        <p className="mb-6 text-silt-soft">You signed in with a temporary password. Replace it with one only you know.</p>
        <PasswordForm user={user} submitLabel="Save my password" onDone={() => void reload()} />
      </div>
    </main>
  );
}
