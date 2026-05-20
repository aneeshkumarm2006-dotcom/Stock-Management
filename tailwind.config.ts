import type { Config } from "tailwindcss";

/*
 * Theme: "Portfolio Neutral" design system, theme-switchable.
 *
 *  - Primary  #38BDF8 (sky)      - Secondary #94A3B8 (slate)
 *  - Tertiary #F1A02B (amber)    - Neutral   #72787C (outline seed)
 *
 * Tokens are exposed as CSS variables (`--c-*` holding space-separated RGB
 * triples) so the same Tailwind utilities resolve to a different palette
 * when `html.dark` vs. `html.light` is set. See `app/globals.css` for the
 * concrete palettes.
 *
 * Two complementary naming layers, same values:
 *  1. Semantic tokens (preferred in app code): bg, surface.*, border,
 *     outline, fg.*, primary.*, secondary, gain, loss, heat.*, error.*.
 *  2. Stitch tonal aliases (surface-container-*, on-surface*, outline-variant,
 *     tertiary, *-container) — kept so existing markup stays 1:1.
 *
 * Note: `primary` is the BRAND sky-blue used for links, active nav, primary
 * buttons, and focus rings. In dark mode it is bright on dark surfaces, so
 * text/icons ON primary use the dark `primary.fg`. In light mode the swatch
 * is darker (#0284C7) for AA contrast on white, and `primary.fg` flips to
 * white. Gain/loss stay green/red — never use the blue primary to indicate
 * a gain (mandatory P&L semantics).
 */
const rgb = (token: string) => `rgb(var(--c-${token}) / <alpha-value>)`;

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
        bg: rgb("bg"),
        surface: {
          DEFAULT: rgb("surface"),
          high: rgb("surface-high"),
          highest: rgb("surface-highest"),
          low: rgb("surface-low"),
          lowest: rgb("surface-lowest"),
        },
        border: rgb("border"),
        outline: rgb("outline"),
        fg: {
          DEFAULT: rgb("fg"),
          muted: rgb("fg-muted"),
        },
        primary: {
          DEFAULT: rgb("primary"),
          container: rgb("primary-container"),
          fg: rgb("primary-fg"),
        },
        secondary: {
          DEFAULT: rgb("secondary"),
          container: rgb("secondary-container"),
        },
        tertiary: {
          DEFAULT: rgb("tertiary"),
          container: rgb("tertiary-container"),
          fg: rgb("tertiary-fg"),
        },
        gain: {
          DEFAULT: rgb("gain"),
          bright: rgb("gain-bright"),
        },
        loss: {
          DEFAULT: rgb("loss"),
          bright: rgb("loss-bright"),
        },
        heat: {
          neg: rgb("heat-neg"),
          mid: rgb("heat-mid"),
          pos: rgb("heat-pos"),
        },
        error: {
          DEFAULT: rgb("error"),
          container: rgb("error-container"),
          fg: rgb("error-fg"),
        },

        // ---- Stitch tonal aliases (design-reference parity) ----
        background: rgb("bg"),
        "on-background": rgb("fg"),
        "on-surface": rgb("fg"),
        "on-surface-variant": rgb("fg-muted"),
        "surface-container-lowest": rgb("surface-lowest"),
        "surface-container-low": rgb("surface-low"),
        "surface-container": rgb("surface"),
        "surface-container-high": rgb("surface-high"),
        "surface-container-highest": rgb("surface-highest"),
        "outline-variant": rgb("border"),
        "secondary-container": rgb("secondary-container"),
        "tertiary-container": rgb("tertiary-container"),
        "primary-container": rgb("primary-container"),
        "on-primary": rgb("primary-fg"),
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
