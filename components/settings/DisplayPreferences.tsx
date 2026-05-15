"use client";

// Display preferences (PDR §5.7): default currency, theme, number format.
// The store is updated optimistically so the change reflows every page
// instantly (Stage 6); the PUT persists it to the server Settings doc. A
// failed write reverts the store and re-syncs from the server.
import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SelectField } from "@/components/panels/fields";
import { useToast } from "@/components/ui/toast";
import { useUiStore } from "@/store/useUiStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useUpdateSettings } from "@/lib/hooks/useSettings";
import type { Currency } from "@/lib/utils/convertCurrency";
import type { NumberFormat } from "@/lib/utils/formatNumber";
import type { Theme } from "@/store/useSettingsStore";

export function DisplayPreferences() {
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const theme = useSettingsStore((s) => s.theme);
  const numberFormat = useSettingsStore((s) => s.numberFormat);
  const setDisplayCurrency = useSettingsStore((s) => s.setDisplayCurrency);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setNumberFormat = useSettingsStore((s) => s.setNumberFormat);

  const isOffline = useUiStore((s) => s.isOffline);
  const { toast } = useToast();
  const update = useUpdateSettings();
  const [savedAt, setSavedAt] = useState(0);

  async function persist(
    patch: { defaultCurrency: Currency } | { theme: Theme } | {
      numberFormat: NumberFormat;
    },
    revert: () => void,
  ) {
    if (isOffline) {
      revert();
      toast({
        title: "You're offline",
        description: "Reconnect to change your preferences.",
        variant: "error",
      });
      return;
    }
    try {
      await update.mutateAsync(patch);
      setSavedAt(Date.now());
      toast({ title: "Preferences saved", variant: "success" });
    } catch (err) {
      revert();
      toast({
        title: "Couldn't save preferences",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "error",
      });
    }
  }

  function onCurrency(next: Currency) {
    const prev = displayCurrency;
    if (next === prev) return;
    setDisplayCurrency(next);
    void persist({ defaultCurrency: next }, () => setDisplayCurrency(prev));
  }

  function onTheme(next: Theme) {
    const prev = theme;
    if (next === prev) return;
    setTheme(next);
    void persist({ theme: next }, () => setTheme(prev));
  }

  function onNumberFormat(next: NumberFormat) {
    const prev = numberFormat;
    if (next === prev) return;
    setNumberFormat(next);
    void persist({ numberFormat: next }, () => setNumberFormat(prev));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Display Preferences</CardTitle>
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-fg-muted">
          {update.isPending ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving…
            </>
          ) : savedAt ? (
            <>
              <Check className="h-3 w-3 text-gain" />
              Saved
            </>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <SelectField
          id="pref-currency"
          label="Default currency"
          value={displayCurrency}
          disabled={update.isPending || isOffline}
          onChange={(e) => onCurrency(e.target.value as Currency)}
        >
          <option value="USD">USD — US Dollar</option>
          <option value="CAD">CAD — Canadian Dollar</option>
        </SelectField>

        <SelectField
          id="pref-theme"
          label="Color theme"
          value={theme}
          disabled={update.isPending || isOffline}
          onChange={(e) => onTheme(e.target.value as Theme)}
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </SelectField>

        <SelectField
          id="pref-number-format"
          label="Number format"
          value={numberFormat}
          disabled={update.isPending || isOffline}
          onChange={(e) => onNumberFormat(e.target.value as NumberFormat)}
        >
          <option value="1,234.56">1,234.56</option>
          <option value="1.234,56">1.234,56</option>
          <option value="1234.56">1234.56</option>
        </SelectField>

        <p className="text-[11px] leading-relaxed text-fg-muted sm:col-span-3">
          Currency and number format apply across every page immediately. This
          version ships a dark theme only; the light option is saved and will
          take effect when light styling is added.
        </p>
      </CardContent>
    </Card>
  );
}
