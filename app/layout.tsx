import type { Metadata, Viewport } from "next";
import { DM_Sans, Fraunces, Oswald } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const sans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm",
  weight: ["400", "500", "600", "700"],
});

const serif = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  weight: ["500", "600", "700"],
});

const condensed = Oswald({
  subsets: ["latin"],
  variable: "--font-oswald",
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: "Luce — editor video",
  description:
    "Taglia, colora ed esporta video dal telefono. Nessun account: i file restano sul dispositivo.",
  applicationName: "Luce",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Luce",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#100f0d",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="it"
      className={`dark ${sans.variable} ${serif.variable} ${condensed.variable} h-full antialiased`}
    >
      <body className="h-full overflow-hidden bg-background text-foreground">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
