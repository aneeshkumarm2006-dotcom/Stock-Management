# Design Tokens — Stock Portfolio Manager

> Resolved from the Google Stitch design system **"Portfolio Dark"**
> (`assets/14850272238750557078`, project `10183713818563396347`).
> These are the canonical tokens. **Stage 6** wires them into
> `tailwind.config` + `globals.css`. Dark theme is the default and only v1 theme
> (a light variant is exposed in Settings but dark is the product default).

## How to read this

Stitch resolves a Material-style tonal palette (the `namedColors` block) from a
small set of seed/override colors. For app code, prefer the **semantic tokens**
in the tables below — they map directly to how the UI uses color. The full
Stitch-resolved palette is preserved at the bottom for completeness.

Seed / overrides that produced the palette:

| Role | Hex |
|---|---|
| `customColor` (brand seed) | `#3B82F6` |
| `overridePrimaryColor` | `#3B82F6` |
| `overrideSecondaryColor` | `#94A3B8` |
| `overrideTertiaryColor` | `#16C784` |
| `overrideNeutralColor` | `#0B0F19` |
| Color mode | `DARK` |
| Color variant | `TONAL_SPOT` |

---

## Color — semantic (use these in app code)

### Surfaces & text

| Token | Hex | Usage |
|---|---|---|
| `bg` / app canvas | `#0A0E18` | Page background (darkest layer) |
| `surface` (card) | `#131929` | Default card / panel surface |
| `surface-high` | `#181F31` | Raised card, popover, dropdown |
| `surface-highest` | `#1D253A` | Inputs, table header, hover row |
| `surface-low` | `#0E1320` | Recessed wells |
| `border` / outline-variant | `#3F485E` | 1px card & divider border |
| `outline` | `#6D758D` | Stronger borders, focus rings |
| `text-primary` | `#DDE5FF` | Primary text, numeric data |
| `text-muted` | `#A2ABC5` | Labels, secondary text |

> The design brief also references softer aliases (`#0B0F19`/`#0F172A` bg,
> `#161B26`/`#1E2533` surface, `#222A38` border, `#E6EAF2`/`#94A3B8` text).
> Use the resolved Stitch hexes above as the source of truth; the brief values
> are visually equivalent and acceptable as fallbacks.

### Brand & interactive

| Token | Hex | Usage |
|---|---|---|
| `primary` (accent) | `#3B82F6` | Links, active nav, primary buttons, focus |
| `primary-container` | `#0E69DC` | Filled primary button background |
| `on-primary` | `#FFFFFF` | Text/icon on primary |
| `secondary` | `#94A3B8` | Secondary controls, muted UI accents |

### P&L semantics — **mandatory & consistent everywhere**

| Token | Hex | Usage |
|---|---|---|
| `gain` / positive | `#16C784` | Positive P&L, % up, up candles, up arrows |
| `loss` / negative | `#EF4444` | Negative P&L, % down, down candles, down arrows |
| `gain` (Stitch tertiary) | `#65FDB5` | Brighter gain accent / chart fills if needed |
| `loss` (Stitch error) | `#FA746F` | Alt loss accent (error states) |

Rule: **never use the blue primary to indicate a gain.** Green = up, red = down,
applied to value changes, % changes, gain/loss text, candlesticks, sparklines,
heatmap, P&L bars.

### Sector heatmap divergent scale

| Stop | Hex |
|---|---|
| Strong negative | `#7F1D1D` |
| Neutral / zero | `#1E2533` |
| Strong positive | `#14532D` |

### Status & feedback

| Token | Hex | Usage |
|---|---|---|
| `error` | `#FA746F` | Error text/icon |
| `error-container` | `#871F21` | Error banner background |
| `on-error-container` | `#FF9993` | Text on error banner |
| market-open pill | `#16C784` | "Market Open" status pill |
| market-closed / stale pill | `#A2ABC5` | "Market Closed" / stale-data indicator |

---

## Typography

Fonts (load via `next/font`): **Space Grotesk** (headline) and **Inter** (body & label).

| Scale token | Font | Size | Weight | Line height | Usage |
|---|---|---|---|---|---|
| `hero-stat` | Space Grotesk | 40px | 700 | 1.2 | Portfolio value / big stat (desktop) |
| `hero-stat-mobile` | Space Grotesk | 32px | 700 | 1.2 | Portfolio value / big stat (mobile) |
| `section-header` | Space Grotesk | 20px | 600 | 28px | Page titles, section H2 |
| `body-ui` | Inter | 14px | 400 | 20px | Body text, form labels, buttons |
| `table-data` | Inter | 13px | 400 | 18px | Dense table rows |

Conventions: tabular/monospaced numerals for all monetary & quantity figures;
numeric table columns are right-aligned.

---

## Radius

Roundness setting: `ROUND_EIGHT` (8px base for controls; ~12px for cards).

| Token | Value |
|---|---|
| `rounded-sm` | `0.25rem` (4px) |
| `rounded` (DEFAULT) | `0.5rem` (8px) |
| `rounded-md` | `0.75rem` (12px) — cards |
| `rounded-lg` | `1rem` (16px) |
| `rounded-xl` | `1.5rem` (24px) |
| `rounded-full` | `9999px` — pills, avatars |

---

## Spacing

Strict **8px increment** grid (`spacingScale: 2` → 8px base unit). Use the
Tailwind default 4px scale but compose layouts on multiples of 8
(`2, 4, 6, 8, 12, 16` = 8/16/24/32/48/64px).

---

## Elevation

Depth via tonal layering, **not shadows**. Each card/container = one step
lighter surface + a 1px `border` (`#3F485E`). Avoid heavy drop shadows on data
surfaces; charts use transparent/dark backgrounds.

---

## Tailwind mapping hint (for Stage 6)

```js
// tailwind.config — theme.extend.colors
const colors = {
  bg:            '#0A0E18',
  surface:       { DEFAULT: '#131929', high: '#181F31', highest: '#1D253A', low: '#0E1320' },
  border:        '#3F485E',
  outline:       '#6D758D',
  fg:            { DEFAULT: '#DDE5FF', muted: '#A2ABC5' },
  primary:       { DEFAULT: '#3B82F6', container: '#0E69DC', fg: '#FFFFFF' },
  secondary:     '#94A3B8',
  gain:          '#16C784',
  loss:          '#EF4444',
  heat:          { neg: '#7F1D1D', mid: '#1E2533', pos: '#14532D' },
  error:         { DEFAULT: '#FA746F', container: '#871F21', fg: '#FF9993' },
};
// fontFamily: { display: ['Space Grotesk', ...], sans: ['Inter', ...] }
// borderRadius default 0.5rem; cards rounded-md (0.75rem)
```

---

## Appendix — full Stitch-resolved palette (`namedColors`)

```
background #0a0e18            on-background #dde5ff
surface #0a0e18              surface-dim #0a0e18          surface-bright #232c41
surface-container-lowest #000000   surface-container-low #0e1320
surface-container #131929    surface-container-high #181f31
surface-container-highest #1d253a  surface-variant #1d253a
on-surface #dde5ff           on-surface-variant #a2abc5
inverse-surface #faf8ff      inverse-on-surface #515561
outline #6d758d              outline-variant #3f485e      surface-tint #adc6ff
primary #adc6ff              on-primary #003d88
primary-container #0e69dc    on-primary-container #ffffff
primary-fixed #4388fd        primary-fixed-dim #317bef    primary-dim #699cff
on-primary-fixed #000000     on-primary-fixed-variant #001435
inverse-primary #005bc4
secondary #b9c8de            on-secondary #334153
secondary-container #2e3c4e  on-secondary-container #b1c0d6
secondary-fixed #d4e4fa      secondary-fixed-dim #c6d6ec  secondary-dim #abbad0
on-secondary-fixed #324052   on-secondary-fixed-variant #4e5d6f
tertiary #65fdb5             on-tertiary #005e3c
tertiary-container #54eea7   on-tertiary-container #005435
tertiary-fixed #54eea7       tertiary-fixed-dim #42e09a   tertiary-dim #42e09a
on-tertiary-fixed #003f26    on-tertiary-fixed-variant #005f3c
error #fa746f                on-error #490006
error-container #871f21      on-error-container #ff9993   error-dim #c54d4a
```

> Note: Stitch's tonal `primary` token resolves to a light blue (`#adc6ff`) for
> on-dark contrast. App code should use the **brand blue `#3B82F6`** (the seed /
> `overridePrimaryColor`) for primary actions, per the semantic table above.
