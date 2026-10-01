import type { Config } from "tailwindcss";

/** Brookrege tokens — calm, low-saturation palette per client brief. */
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        limestone: "#F2F3EF", // page background
        silt: { DEFAULT: "#22302C", soft: "#56625D" }, // text
        palm: { DEFAULT: "#41594F", dark: "#33473F", tint: "#E3EAE5" }, // primary actions
        sandstone: { DEFAULT: "#A8875A", dark: "#7A5F38", tint: "#F1EADF" }, // prices only
        reed: "#D9DDD5", // lines and borders
        gold: { DEFAULT: "#C4A474", strong: "#D6BA8C", on: "#1A1610" }, // main buttons, as on the website
        ink: "#0B0F13", // sidebar and sign-in, as the website's film
      },
      fontFamily: { sans: ["var(--font-plex)", "system-ui", "sans-serif"], serif: ["var(--font-marcellus)", "Georgia", "serif"] },
      fontSize: {
        // Modular scale ~1.25, line heights tuned per size
        xs: ["0.8125rem", "1.25rem"],
        sm: ["0.875rem", "1.375rem"],
        base: ["1rem", "1.625rem"],
        lg: ["1.25rem", "1.75rem"],
        xl: ["1.75rem", "2.25rem"],
        "2xl": ["2.5rem", "3rem"],
      },
      maxWidth: { page: "72rem" },
      borderRadius: { tile: "10px" },
    },
  },
  plugins: [],
} satisfies Config;
