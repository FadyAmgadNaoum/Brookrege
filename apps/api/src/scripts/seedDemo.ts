/**
 * Demo data for development and client previews. Idempotent: safe to run repeatedly.
 * NOT for production — production uses scripts/bootstrap.ts (admin only, no sample data).
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { computeExpiry } from "@brookrege/domain";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@brookrege.com";
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < 12) throw new Error("Set SEED_ADMIN_PASSWORD (min 12 chars).");

  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: "Super Admin", role: "SUPER_ADMIN", passwordHash: await bcrypt.hash(password, 12) },
  });

  await prisma.setting.upsert({
    where: { key: "listing_duration_months" },
    update: {},
    create: { key: "listing_duration_months", value: 3 },
  });

  // PLACEHOLDER regions — the final list is pending client confirmation.
  const regions = [
    { slug: "sohag-city", name: "Sohag City", nameAr: "مدينة سوهاج", sortOrder: 1 },
    { slug: "new-sohag", name: "New Sohag", nameAr: "سوهاج الجديدة", sortOrder: 2 },
    { slug: "al-kawthar", name: "Al Kawthar", nameAr: "الكوثر", sortOrder: 3 },
  ];
  for (const r of regions) await prisma.region.upsert({ where: { slug: r.slug }, update: {}, create: r });
  const sohag = await prisma.region.findUniqueOrThrow({ where: { slug: "sohag-city" } });
  const kawthar = await prisma.region.findUniqueOrThrow({ where: { slug: "al-kawthar" } });

  // Compound names come from the client brief; details are sample data.
  const retaj = await prisma.compound.upsert({
    where: { slug: "retaj" },
    update: {},
    create: { slug: "retaj", name: "Retaj", nameAr: "رتاج", regionId: sohag.id, sortOrder: 1 },
  });
  const sidra = await prisma.compound.upsert({
    where: { slug: "sidra" },
    update: {},
    create: { slug: "sidra", name: "Sidra", nameAr: "سدرة", regionId: kawthar.id, sortOrder: 2 },
  });

  if ((await prisma.property.count()) === 0) {
    const now = new Date();
    const active = { status: "ACTIVE" as const, listedAt: now, expiresAt: computeExpiry(now), createdById: admin.id };
    await prisma.property.createMany({
      data: [
        { ...active, title: "شقة ٣ غرف في كمبوند رتاج", titleEn: "3-bedroom apartment in Retaj", type: "APARTMENT", transaction: "SALE", sellerType: "DEVELOPER", price: 1850000, areaSqm: 140, bedrooms: 3, bathrooms: 2, regionId: sohag.id, compoundId: retaj.id, latitude: 26.5569, longitude: 31.6948 },
        { ...active, title: "شقة غرفتين في كمبوند رتاج", titleEn: "2-bedroom apartment in Retaj", type: "APARTMENT", transaction: "SALE", sellerType: "DEVELOPER", price: 1350000, areaSqm: 110, bedrooms: 2, bathrooms: 1, regionId: sohag.id, compoundId: retaj.id, latitude: 26.5575, longitude: 31.6952 },
        { ...active, title: "فيلا بحديقة في كمبوند سدرة", titleEn: "Villa with garden in Sidra", type: "VILLA", transaction: "SALE", sellerType: "DEVELOPER", price: 6200000, areaSqm: 320, bedrooms: 4, bathrooms: 4, regionId: kawthar.id, compoundId: sidra.id, latitude: 26.5412, longitude: 31.7021 },
        { ...active, title: "شقة إعادة بيع قرب الكورنيش", titleEn: "Resale apartment near the corniche", type: "APARTMENT", transaction: "SALE", sellerType: "RESALE", price: 1100000, areaSqm: 125, bedrooms: 3, bathrooms: 2, regionId: sohag.id, latitude: 26.5603, longitude: 31.6915 },
        { ...active, title: "محل على الشارع الرئيسي", titleEn: "Street-front shop", type: "SHOP", transaction: "SALE", sellerType: "RESALE", price: 950000, areaSqm: 45, regionId: sohag.id, latitude: 26.5588, longitude: 31.6899 },
        { ...active, title: "قطعة أرض سكنية", titleEn: "Residential land plot", type: "LAND", transaction: "SALE", sellerType: "RESALE", price: 2400000, areaSqm: 400, regionId: kawthar.id },
        { ...active, title: "شقة مفروشة للإيجار", titleEn: "Furnished apartment for rent", type: "APARTMENT", transaction: "RENT", price: 7500, areaSqm: 120, bedrooms: 2, bathrooms: 1, regionId: sohag.id, latitude: 26.5621, longitude: 31.6937 },
        { ...active, title: "محل للإيجار على الطريق الرئيسي", titleEn: "Shop for rent on the main road", type: "SHOP", transaction: "RENT", price: 12000, areaSqm: 60, regionId: kawthar.id },
      ],
    });
  }

  if ((await prisma.project.count()) === 0) {
    await prisma.project.createMany({
      data: [
        { kind: "PARTNERSHIP", slug: "retaj-phase-2", name: "Retaj Phase 2", nameAr: "رتاج – المرحلة الثانية", partnerName: "Retaj Developments", regionId: sohag.id, description: "شراكة لتسويق ١٢٠ وحدة سكنية في المرحلة الثانية من كمبوند رتاج.", descriptionEn: "Marketing partnership for 120 homes in the second phase of Retaj.", sortOrder: 1 },
        { kind: "COMPLETED", slug: "nile-towers", name: "Nile Towers", nameAr: "أبراج النيل", regionId: sohag.id, completedAt: new Date("2025-06-01"), description: "تم بيع جميع الوحدات (٦٤ وحدة) خلال ١٤ شهرًا.", descriptionEn: "All 64 units sold within 14 months.", sortOrder: 1 },
      ],
    });
  }

  console.log(`Seed complete. Admin: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
