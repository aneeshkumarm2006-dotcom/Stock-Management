import type { Config } from "tailwindcss";

/*
 * Theme: "Portfolio Neutral" design system.
 *
 *  - Primary  #38BDF8 (sky)      - Secondary #94A3B8 (slate)
 *  - Tertiary #F1A02B (amber)    - Neutral   #72787C (outline seed)
 *
 * Two complementary naming layers, same values:
 *  1. Semantic tokens (preferred in app code): bg, surface.*, border,
 *     outline, fg.*, primary.*, secondary, gain, loss, heat.*, error.*.
 *  2. Stitch tonal aliases (surface-container-*, on-surface*, outline-variant,
 *     tertiary, *-container) — kept so existing markup stays 1:1.
 *
 * Note: `primary` is the BRAND sky-blue (#38BDF8) used for links, active nav,
 * primary buttons, and focus rings. Because it is bright, text/icons ON primary
 * use the dark `primary.fg`. Gain/loss stay green/red — never use the blue
 * primary to indicate a gain (mandatory P&L semantics).
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // ---- Semantic (preferred) ----
        bg: "#0C0D10",
        surface: {
          DEFAULT: "#16181D",
          high: "#1D1F26",
          highest: "#24272F",
          low: "#101216",
          lowest: "#000000",
        },
        border: "#2B2E37",
        outline: "#72787C",
        fg: {
          DEFAULT: "#E6E8EC",
          muted: "#94A3B8",
        },
        primary: {
          DEFAULT: "#38BDF8",
          container: "#0EA5E9",
          fg: "#082131",
        },
        secondary: {
          DEFAULT: "#94A3B8",
          container: "#2A3340",
        },
        tertiary: {
          DEFAULT: "#F1A02B",
          container: "#7A4E12",
          fg: "#0C0D10",
        },
        gain: {
          DEFAULT: "#16C784",
          bright: "#65FDB5",
        },
        loss: {
          DEFAULT: "#EF4444",
          bright: "#FA746F",
        },
        heat: {
          neg: "#7F1D1D",
          mid: "#1F232B",
          pos: "#14532D",
        },
        error: {
          DEFAULT: "#FA746F",
          container: "#871F21",
          fg: "#FF9993",
        },

        // ---- Stitch tonal aliases (design-reference parity) ----
        background: "#0C0D10",
        "on-background": "#E6E8EC",
        "on-surface": "#E6E8EC",
        "on-surface-variant": "#94A3B8",
        "surface-container-lowest": "#000000",
        "surface-container-low": "#101216",
        "surface-container": "#16181D",
        "surface-container-high": "#1D1F26",
        "surface-container-highest": "#24272F",
        "outline-variant": "#2B2E37",
        "secondary-container": "#2A3340",
        "tertiary-container": "#7A4E12",
        "primary-container": "#0EA5E9",
        "on-primary": "#082131",
      },
      fontFamily: {
        display: ["var(--font-display)", "Hanken Grotesk", "sans-serif"],
        headline: ["var(--font-display)", "Hanken Grotesk", "sans-serif"],
        sans: ["var(--font-sans)", "Inter", "ui-sans-serif", "system-ui"],
        body: ["var(--font-sans)", "Inter", "ui-sans-serif", "system-ui"],
        mono: [
          "var(--font-mono)",
          "JetBrains Mono",
          "ui-monospace",
          "monospace",
        ],
        label: [
          "var(--font-mono)",
          "JetBrains Mono",
          "ui-monospace",
          "monospace",
        ],
      },
      borderRadius: {
        sm: "0.25rem",
        DEFAULT: "0.5rem",
        md: "0.75rem",
        lg: "1rem",
        xl: "1.5rem",
        full: "9999px",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 150ms ease-out",
        "slide-in-right": "slide-in-right 200ms ease-out",
      },
    },
  },
  plugins: [],
};
export default config;
