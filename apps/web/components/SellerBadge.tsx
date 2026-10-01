import type { SellerType, TransactionType } from "@brookrege/domain";
import type { Dict } from "@/lib/i18n";

/** Client requirement: clearly separate "For sale – developer" from "For sale – resale". */
export function SellerBadge({ t, transaction, sellerType }: { t: Dict; transaction: TransactionType; sellerType: SellerType | null }) {
  if (transaction === "RENT") return <span className="rounded bg-reed/60 px-2 py-0.5 text-xs text-silt">{t.seller.RENT}</span>;
  if (sellerType === "DEVELOPER") return <span className="rounded bg-palm-tint px-2 py-0.5 text-xs text-palm-dark">{t.seller.DEVELOPER}</span>;
  return <span className="rounded bg-sandstone-tint px-2 py-0.5 text-xs text-sandstone-dark">{t.seller.RESALE}</span>;
}
