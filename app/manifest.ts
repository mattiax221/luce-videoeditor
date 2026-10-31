import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Luce",
    short_name: "Luce",
    description: "Editor video sul telefono. Taglia, colora, esporta.",
    start_url: "/",
    display: "standalone",
    background_color: "#100f0d",
    theme_color: "#100f0d",
    lang: "it",
  };
}
