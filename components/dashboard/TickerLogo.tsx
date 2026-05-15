"use client";

// Company logo chip with a graceful fallback to the ticker's initial when
// the Finnhub logo URL is absent or fails to load (PDR §5.2 table).
import * as React from "react";
import { cn } from "@/lib/utils/cn";

export function TickerLogo({
  ticker,
  name,
  logo,
  className,
}: {
  ticker: string;
  name?: string | null;
  logo?: string | null;
  className?: string;
}) {
  const [broken, setBroken] = React.useState(false);
  const showImg = logo && !broken;

  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border border-border",
        showImg ? "bg-white p-1" : "bg-surface-highest",
        className,
      )}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element -- external Finnhub logo CDN; no loader config worth adding
        <img
          src={logo}
          alt={name ?? ticker}
          className="h-full w-full object-contain"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="text-[11px] font-black text-fg">
          {ticker.charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  );
}
