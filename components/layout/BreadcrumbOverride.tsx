"use client";

// STATE-015: breadcrumb leaf-label override. The TopBar derives the breadcrumb
// from the URL and substitutes any opaque id segment (digits / hex) with the
// literal "Detail" — so two different record detail pages produce identical,
// useless crumbs ("Properties / Detail").
//
// Detail pages mount <BreadcrumbOverride label={record.name} /> once their data
// loads; the TopBar reads the override from this context and renders it in place
// of the leaf "Detail" crumb. When the override is null (route without a detail
// page, or data not yet loaded) the TopBar falls back to its URL-derived label.
import * as React from "react";

interface BreadcrumbOverrideCtx {
  label: string | null;
  setLabel: (label: string | null) => void;
}

const Ctx = React.createContext<BreadcrumbOverrideCtx | null>(null);

export function BreadcrumbOverrideProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [label, setLabel] = React.useState<string | null>(null);
  const value = React.useMemo(() => ({ label, setLabel }), [label]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Read the current override label (used by the TopBar breadcrumb). */
export function useBreadcrumbOverrideLabel(): string | null {
  return React.useContext(Ctx)?.label ?? null;
}

/**
 * Declarative setter for detail pages. Renders nothing; sets the breadcrumb
 * leaf label on mount / when `label` changes and clears it on unmount.
 *
 *   <BreadcrumbOverride label={property?.name ?? null} />
 */
export function BreadcrumbOverride({ label }: { label: string | null }) {
  const ctx = React.useContext(Ctx);
  React.useEffect(() => {
    ctx?.setLabel(label);
    return () => ctx?.setLabel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label]);
  return null;
}

export default BreadcrumbOverride;
