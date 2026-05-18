"use client";

// OHLCV candlestick chart (PDR §5.4; Tech_Stack §Charts — lightweight-charts
// by TradingView, chosen for native horizontal price lines). Range selector
// 1W / 1M / 3M / 6M / 1Y. When the user holds the symbol, a dashed horizontal
// line marks their average buy price so the candles read against cost basis.
//
// lightweight-charts is imported dynamically inside the mount effect so it is
// never evaluated during SSR and stays out of the initial bundle (it is only
// needed on this one page). Colors come straight from the "Portfolio Dark"
// tokens (tokens.md): green up / red down candles, never the blue primary for
// a gain.
import * as React from "react";
import type {
  IChartApi,
  ISeriesApi,
  IPriceLine,
  UTCTimestamp,
} from "lightweight-charts";
import { RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils/cn";
import { RANGES, type WireCandle } from "@/lib/hooks/useStockDetail";
import type { HistoricalRange } from "@/lib/db/models/HistoricalCache";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import type { Currency } from "@/lib/utils/convertCurrency";
import { useSettingsStore } from "@/store/useSettingsStore";

/* tokens.md — chart palette */
const UP = "#16C784";
const DOWN = "#EF4444";
const GRID = "#24272F"; // surface-highest, very low contrast gridlines
const BORDER = "#2B2E37";
const AXIS_TEXT = "#94A3B8"; // on-surface-variant
const AVG_LINE = "#38BDF8"; // primary — explicitly a reference, not a P&L color

interface CandlestickChartProps {
  candles: WireCandle[];
  range: HistoricalRange;
  onRangeChange: (r: HistoricalRange) => void;
  isLoading: boolean;
  error?: string | null;
  onRetry?: () => void;
  stale?: boolean;
  /** Dashed reference line at the user's average buy price (held only). */
  avgBuyPrice?: number | null;
  /** Currency of `avgBuyPrice` (the position's native currency). */
  avgBuyCurrency?: Currency;
  /** 1W uses 1h candles → show intraday time on the axis. */
  intraday: boolean;
}

interface ChartHandles {
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
}

/** ISO → UTC seconds; lightweight-charts wants ascending, unique numeric time. */
function toSeries(candles: WireCandle[]) {
  const out: Array<{
    time: UTCTimestamp;
    open: number;
    high: number;
    low: number;
    close: number;
  }> = [];
  let prev = -Infinity;
  for (const c of candles) {
    const t = Math.floor(new Date(c.time).getTime() / 1000);
    if (
      !Number.isFinite(t) ||
      !Number.isFinite(c.open) ||
      !Number.isFinite(c.high) ||
      !Number.isFinite(c.low) ||
      !Number.isFinite(c.close)
    ) {
      continue;
    }
    if (t <= prev) continue; // drop any out-of-order / duplicate timestamps
    prev = t;
    out.push({
      time: t as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    });
  }
  return out;
}

export function CandlestickChart({
  candles,
  range,
  onRangeChange,
  isLoading,
  error,
  onRetry,
  stale,
  avgBuyPrice,
  avgBuyCurrency = "USD",
  intraday,
}: CandlestickChartProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const handlesRef = React.useRef<ChartHandles | null>(null);
  const priceLineRef = React.useRef<IPriceLine | null>(null);
  const [ready, setReady] = React.useState(false);
  const numberFormat = useSettingsStore((s) => s.numberFormat);

  // Mount: build the chart once. Dynamic import keeps it off the server and
  // out of the initial bundle.
  React.useEffect(() => {
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;

    void (async () => {
      const lwc = await import("lightweight-charts");
      const el = containerRef.current;
      if (disposed || !el) return;

      const chart = lwc.createChart(el, {
        layout: {
          background: { type: lwc.ColorType.Solid, color: "transparent" },
          textColor: AXIS_TEXT,
          fontFamily: "var(--font-inter), system-ui, sans-serif",
        },
        grid: {
          vertLines: { color: GRID },
          horzLines: { color: GRID },
        },
        rightPriceScale: { borderColor: BORDER },
        timeScale: {
          borderColor: BORDER,
          secondsVisible: false,
        },
        crosshair: { mode: lwc.CrosshairMode.Normal },
        autoSize: false,
        width: el.clientWidth,
        height: el.clientHeight,
      });

      const series = chart.addCandlestickSeries({
        upColor: UP,
        downColor: DOWN,
        borderUpColor: UP,
        borderDownColor: DOWN,
        wickUpColor: UP,
        wickDownColor: DOWN,
      });

      handlesRef.current = { chart, series };
      setReady(true);

      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const { width, height } = entry.contentRect;
        chart.resize(Math.floor(width), Math.floor(height));
      });
      resizeObserver.observe(el);
    })();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      handlesRef.current?.chart.remove();
      handlesRef.current = null;
      priceLineRef.current = null;
      setReady(false);
    };
  }, []);

  // Show the time-of-day on the axis only for the intraday (1W / 1h) range.
  React.useEffect(() => {
    const handles = handlesRef.current;
    if (!ready || !handles) return;
    handles.chart.applyOptions({ timeScale: { timeVisible: intraday } });
  }, [ready, intraday]);

  // Feed data whenever the candles (range switch / refetch) change.
  React.useEffect(() => {
    const handles = handlesRef.current;
    if (!ready || !handles) return;
    const data = toSeries(candles);
    handles.series.setData(data);
    if (data.length > 0) handles.chart.timeScale().fitContent();
  }, [ready, candles]);

  // Average-buy reference line — only when the user holds the symbol.
  React.useEffect(() => {
    const handles = handlesRef.current;
    if (!ready || !handles) return;

    if (priceLineRef.current) {
      handles.series.removePriceLine(priceLineRef.current);
      priceLineRef.current = null;
    }
    if (avgBuyPrice != null && Number.isFinite(avgBuyPrice)) {
      void import("lightweight-charts").then((lwc) => {
        if (!handlesRef.current) return;
        priceLineRef.current = handlesRef.current.series.createPriceLine({
          price: avgBuyPrice,
          color: AVG_LINE,
          lineWidth: 1,
          lineStyle: lwc.LineStyle.Dashed,
          axisLabelVisible: true,
          title: "Avg buy",
        });
      });
    }
  }, [ready, avgBuyPrice, candles]);

  const showOverlay = isLoading || !!error || (ready && candles.length === 0);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-display text-sm font-bold uppercase tracking-wider text-fg">
            Price History
          </h3>
          {stale && (
            <span className="text-[10px] font-medium uppercase tracking-wider text-fg-muted">
              Cached
            </span>
          )}
          {avgBuyPrice != null && Number.isFinite(avgBuyPrice) && (
            <span className="flex items-center gap-1.5 text-[10px] font-medium text-fg-muted">
              <span
                className="inline-block h-0 w-4 border-t border-dashed"
                style={{ borderColor: AVG_LINE }}
              />
              Avg buy{" "}
              {formatCurrency(avgBuyPrice, avgBuyCurrency, {
                format: numberFormat,
              })}
            </span>
          )}
        </div>
        <div
          role="tablist"
          aria-label="Chart range"
          className="inline-flex gap-0.5 self-start rounded border border-border bg-surface-low p-0.5"
        >
          {RANGES.map((r) => {
            const selected = r === range;
            return (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => onRangeChange(r)}
                className={cn(
                  "rounded px-3 py-1 text-[10px] font-bold transition-colors",
                  selected
                    ? "bg-surface-highest text-fg"
                    : "text-fg-muted hover:text-fg",
                )}
              >
                {r}
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative">
        <div
          ref={containerRef}
          className="h-[320px] w-full sm:h-[420px]"
          aria-label="Candlestick price chart"
          role="img"
        />
        {showOverlay && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-high/60 text-center">
            {isLoading ? (
              <>
                <Spinner className="h-5 w-5" />
                <span className="text-xs text-fg-muted">
                  Loading price history…
                </span>
              </>
            ) : error ? (
              <>
                <p className="text-sm font-semibold text-fg">
                  Chart unavailable
                </p>
                <p className="max-w-xs text-xs text-fg-muted">{error}</p>
                {onRetry && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-1"
                    onClick={onRetry}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry
                  </Button>
                )}
              </>
            ) : (
              <p className="text-xs text-fg-muted">
                No price history for this range.
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
