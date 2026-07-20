import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CAVITY GAME — F.I.S.T.",
    short_name: "CAVITY GAME",
    description: "Simulateur officiel de tir en cavité, homologué par la F.I.S.T.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#050e1e",
    theme_color: "#050e1e",
    orientation: "portrait",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png" }
    ]
  };
}
