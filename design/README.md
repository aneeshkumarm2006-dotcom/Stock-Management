# Design References — Stock Portfolio Manager

Source of truth for all UI work (Stages 6–14). Built with the **Google Stitch**
project `projects/10183713818563396347`, design system **"Portfolio Dark"**
(`assets/14850272238750557078`).

## Canonical design tokens

**`tokens.md`** is the authoritative spec — resolved colors (semantic + full
palette), typography scale, radius, spacing, elevation, and a Tailwind mapping.
Stage 6 wires these into `tailwind.config` + `globals.css`. Every page must use
these tokens regardless of whether it has a dedicated screen mockup below.

## Saved screen references

One subfolder per screen. `desktop.*` and `mobile.*` each include the Stitch
screenshot (`.png`) and exported markup (`.html`).

| Screen | Folder | PDR ref |
|---|---|---|
| Login | `login/` | §4 |
| Signup | `signup/` | §4 |
| Dashboard | `dashboard/` | §5.2 |
| Portfolio (holdings + add/edit) | `portfolio/` | §5.1, §5.3 |

> **Mobile = responsive.** Per project direction, mobile is implemented as a
> responsive treatment of the same design in code (Stage 6/15), not as separate
> per-page mockups. The `mobile.*` files present are reference variants only;
> the desktop reference + `tokens.md` + the responsive rules in `tokens.md`
> (sidebar → bottom tab bar < 768px, single-column stacking, condensed tables)
> govern mobile.

## Pages without a dedicated mockup

**Add/Edit Position, Stock detail, Market insights, Analytics, Settings, and the
App shell** intentionally have **no separate Stitch mockup** (per project
direction: no new designs generated). They are built to the same design system:

- The **app shell** (left sidebar nav, top bar with market open/closed pill,
  refresh, last-updated timestamp, USD/CAD toggle, account menu) is fully
  visible in `dashboard/` and `portfolio/` — reuse that chrome verbatim.
- The component vocabulary (stat cards, dense tables with logo+ticker cells and
  exchange pills, allocation donut, badges, skeletons) is established in the
  saved references and `tokens.md`.
- Per-page composition follows **PDR §5** (`_ai_context/PDR.md`):
  §5.1 add/edit panel, §5.4 stock detail, §5.5 market, §5.6 analytics, §5.7
  settings. The Stitch design system "Portfolio Dark" guarantees visual
  consistency across all of them.
