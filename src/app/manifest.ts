import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cashflow Real",
    short_name: "Cashflow",
    description: "Dashboard cashflow i sprzedaży Fitssey",
    start_url: "/cashflow",
    scope: "/",
    display: "standalone",
    background_color: "#f6f8fb",
    theme_color: "#2563eb",
    lang: "pl",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
