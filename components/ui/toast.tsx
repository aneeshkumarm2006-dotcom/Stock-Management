"use client";

// Toast system: <ToastProvider> (mounted once in Providers) + useToast().
// Used for network-offline notices (PDR §11) and mutation feedback.
import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type ToastVariant = "default" | "success" | "error";

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** ms before auto-dismiss; 0 keeps it until dismissed. Default 4000. */
  duration?: number;
}

interface ToastCtx {
  /** Shows a toast and returns its id so callers can dismiss it early. */
  toast: (t: ToastInput) => number;
  dismiss: (id: number) => void;
}

const Ctx = React.createContext<ToastCtx | null>(null);

export function useToast(): ToastCtx {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

const ICON: Record<ToastVariant, React.ReactNode> = {
  default: <Info className="h-4 w-4 text-primary" />,
  success: <CheckCircle2 className="h-4 w-4 text-gain" />,
  error: <AlertCircle className="h-4 w-4 text-error" />,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const idRef = React.useRef(0);

  const dismiss = React.useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback(
    ({ title, description, variant = "default", duration = 4000 }: ToastInput) => {
      const id = ++idRef.current;
      setItems((prev) => [...prev, { id, title, description, variant }]);
      if (duration > 0) {
        setTimeout(() => dismiss(id), duration);
      }
      return id;
    },
    [dismiss],
  );

  return (
    <Ctx.Provider value={{ toast, dismiss }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-full max-w-sm flex-col gap-2">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 24, scale: 0.98 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              className={cn(
                "pointer-events-auto flex items-start gap-3 rounded-md border bg-surface-high p-4",
                t.variant === "error"
                  ? "border-error/40"
                  : t.variant === "success"
                    ? "border-gain/40"
                    : "border-border",
              )}
            >
              <div className="mt-0.5 shrink-0">{ICON[t.variant]}</div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-fg">{t.title}</p>
                {t.description && (
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {t.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => dismiss(t.id)}
                className="text-fg-muted transition-colors hover:text-fg"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
