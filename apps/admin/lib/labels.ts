import type { ListingStatus } from "@brookrege/domain";

export const STATUS_LABEL: Record<ListingStatus, string> = {
  DRAFT: "Draft",
  ACTIVE: "Live",
  EXPIRED: "Expired",
  SOLD: "Sold",
  ARCHIVED: "Archived",
};

export const STATUS_STYLE: Record<ListingStatus, string> = {
  DRAFT: "bg-reed/60 text-silt",
  ACTIVE: "bg-palm-tint text-palm-dark",
  EXPIRED: "bg-amber-50 text-amber-800",
  SOLD: "bg-sandstone-tint text-sandstone-dark",
  ARCHIVED: "bg-limestone text-silt-soft",
};

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

export const fmtDateTime = (d: string) =>
  new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
