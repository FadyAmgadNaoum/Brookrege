import type { Config } from "tailwindcss";

/** Colours are CSS variables (see globals.css) so light and dark themes share every class name. */
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        limestone: v("bg"), // page background
        surface: v("surface"), // cards, inputs, panels
        silt: { DEFAULT: v("text"), soft: v("text-soft") },
        palm: { DEFAULT: v("palm"), dark: v("palm-strong"), tint: v("palm-tint"), on: v("on-palm") },
        sandstone: { DEFAULT: v("sand"), dark: v("sand-strong"), tint: v("sand-tint") },
        reed: v("line"),
        gold: { DEFAULT: v("gold"), strong: v("gold-strong"), on: v("on-gold") },
      },
      fontFamily: { sans: ["var(--font-plex)", "system-ui", "sans-serif"] },
      fontSize: {
        xs: ["0.8125rem", "1.25rem"],
        sm: ["0.875rem", "1.375rem"],
        base: ["1rem", "1.625rem"],
        lg: ["1.25rem", "1.75rem"],
        xl: ["1.75rem", "2.25rem"],
        "2xl": ["2.5rem", "3rem"],
      },
      maxWidth: { page: "72rem" },
      borderRadius: { tile: "4px", card: "6px" },
      transitionTimingFunction: { apple: "cubic-bezier(0.28, 0.11, 0.32, 1)" },
    },
  },
  plugins: [],
} satisfies Config;
