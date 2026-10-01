import { notFound } from "next/navigation";

/** Unknown URLs under /ar or /en render the localized not-found page. */
export default function CatchAll() {
  notFound();
}
