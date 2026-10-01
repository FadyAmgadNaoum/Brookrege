import { expireListings } from "./expireListings";
import { prisma } from "../lib/prisma";

expireListings()
  .then((n) => console.log(`Expired ${n} listing(s).`))
  .finally(() => prisma.$disconnect());
