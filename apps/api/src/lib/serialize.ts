import type { Prisma } from "@prisma/client";

/** Prisma Decimal -> number for JSON. EGP amounts fit safely within Number precision. */
export const toNumber = (d: Prisma.Decimal | number | null | undefined): number | null =>
  d == null ? null : typeof d === "number" ? d : d.toNumber();

type WithPrice = { price: Prisma.Decimal | number };
export function serializeProperty<T extends WithPrice>(p: T): Omit<T, "price"> & { price: number } {
  return { ...p, price: toNumber(p.price) as number };
}
