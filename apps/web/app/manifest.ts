import type { MetadataRoute } from "next";

/** "Add to home screen" on phones. Icons: scripts/brand/build_icons.py. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Brookrege — عقارات في سوهاج",
    short_name: "Brookrege",
    start_url: "/ar",
    display: "browser",
    background_color: "#F2F3EF",
    theme_color: "#41594F",
    lang: "ar-EG",
    dir: "rtl",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
