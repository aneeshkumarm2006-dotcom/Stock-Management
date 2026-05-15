import type { Config } from "tailwindcss";

/*
 * Theme wired from the Stitch design system "Portfolio Dark"
 * (site/design/tokens.md). Two complementary naming layers, same values:
 *
 *  1. Semantic tokens (preferred in app code): bg, surface.*, border,
 *     outline, fg.*, primary.*, secondary, gain, loss, heat.*, error.*.
 *  2. Stitch tonal aliases (surface-container-*, on-surface*, outline-variant,
 *     tertiary, *-container) — kept so markup built to match the saved
 *     site/design/*.html references stays 1:1 with the reference classes.
 *
 * Note: per tokens.md, the semantic `primary` is the BRAND blue (#3B82F6),
 * not the Stitch tonal light-blue — used for links, active nav, primary
 * buttons, and focus rings.
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
        bg: "#0A0E18",
        surface: {
          DEFAULT: "#131929",
          high: "#181F31",
          highest: "#1D253A",
          low: "#0E1320",
          lowest: "#000000",
        },
        border: "#3F485E",
        outline: "#6D758D",
        fg: {
          DEFAULT: "#DDE5FF",
          muted: "#A2ABC5",
        },
        primary: {
          DEFAULT: "#3B82F6",
          container: "#0E69DC",
          fg: "#FFFFFF",
        },
        secondary: {
          DEFAULT: "#94A3B8",
          container: "#2E3C4E",
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
          mid: "#1E2533",
          pos: "#14532D",
        },
        error: {
          DEFAULT: "#FA746F",
          container: "#871F21",
          fg: "#FF9993",
        },

        // ---- Stitch tonal aliases (design-reference parity) ----
        background: "#0A0E18",
        "on-background": "#DDE5FF",
        "on-surface": "#DDE5FF",
        "on-surface-variant": "#A2ABC5",
        "surface-container-lowest": "#000000",
        "surface-container-low": "#0E1320",
        "surface-container": "#131929",
        "surface-container-high": "#181F31",
        "surface-container-highest": "#1D253A",
        "outline-variant": "#3F485E",
        tertiary: "#16C784",
        "secondary-container": "#2E3C4E",
        "primary-container": "#0E69DC",
        "on-primary": "#FFFFFF",
      },
      fontFamily: {
        display: ["var(--font-display)", "Space Grotesk", "sans-serif"],
        headline: ["var(--font-display)", "Space Grotesk", "sans-serif"],
        sans: ["var(--font-sans)", "Inter", "ui-sans-serif", "system-ui"],
        body: ["var(--font-sans)", "Inter", "ui-sans-serif", "system-ui"],
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
