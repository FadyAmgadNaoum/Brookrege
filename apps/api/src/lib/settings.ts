import { DEFAULT_LISTING_DURATION_MONTHS } from "@brookrege/domain";
import { prisma } from "./prisma";

export async function getListingDurationMonths(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: "listing_duration_months" } });
  const v = typeof row?.value === "number" ? row.value : DEFAULT_LISTING_DURATION_MONTHS;
  return Number.isInteger(v) && v >= 1 && v <= 24 ? v : DEFAULT_LISTING_DURATION_MONTHS;
}
