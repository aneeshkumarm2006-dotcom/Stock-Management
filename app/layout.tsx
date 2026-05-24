import type { Metadata } from "next";
import { Onest, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers/Providers";

// Onest serves both sans body copy and display headings — same approach as the
// Lattice design bundle (a single warm humanist sans across the whole shell).
const onest = Onest({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

const onestDisplay = Onest({
  subsets: ["latin"],
  display: "swap",
  weight: ["500", "600", "700"],
  variable: "--font-display",
});

// Geist Mono (the design's authored monospace) isn't shipped by Next 14.2's
// next/font/google; JetBrains Mono is a close substitute and the Tailwind
// font-mono stack still lists "Geist Mono" first so locally-installed copies
// win when available.
const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_APP_NAME ?? "Portfolio",
  description:
    "Multi-user stock portfolio tracker for US (NYSE/NASDAQ) and Canadian (TSX) markets.",
};

// Runs before React hydrates so a saved preference doesn't flash the wrong
// theme on the first paint. Reads the persisted Settings store (see
// store/useSettingsStore.ts, key `spm-settings`) and swaps the `light`/`dark`
// class on <html>. Default is light to match the Lattice design's native
// variant; users can still flip to dark via Settings.
const themeBootScript = `(() => {
  try {
    var raw = localStorage.getItem('spm-settings');
    var theme = 'light';
    if (raw) {
      var parsed = JSON.parse(raw);
      var stored = parsed && parsed.state && parsed.state.theme;
      if (stored === 'light' || stored === 'dark') theme = stored;
    }
    var root = document.documentElement;
    root.classList.remove(theme === 'light' ? 'dark' : 'light');
    root.classList.add(theme);
  } catch (e) {}
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`light ${onest.variable} ${onestDisplay.variable} ${monoFont.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: themeBootScript }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
