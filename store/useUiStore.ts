// Transient client-only UI state (Tech_Stack.md §State management): slide-in
// panel open/close, mobile nav, last manual-refresh timestamp, offline flag.
// Server data is owned by TanStack Query, never mirrored here. Not persisted.
import { create } from "zustand";

interface UiState {
  /** Add-position slide-in panel (Stage 9). */
  addPanelOpen: boolean;
  /** Position id currently being edited, or null (Stage 9 edit panel). */
  editPanelPositionId: string | null;
  /** Mobile drawer/nav open state (< 768px). */
  mobileNavOpen: boolean;
  /** Last successful manual/auto refresh — drives the TopBar timestamp. */
  lastRefreshAt: number | null;
  /**
   * Epoch ms until which client fetches should append `?refresh=1` and bypass
   * the server cache TTL (Stage 14 manual refresh). 0 = no force window open.
   */
  forceRefreshUntil: number;
  /** Browser offline (PDR §11 — disable mutations + toast). */
  isOffline: boolean;

  openAddPanel: () => void;
  closeAddPanel: () => void;
  openEditPanel: (positionId: string) => void;
  closeEditPanel: () => void;
  setMobileNavOpen: (open: boolean) => void;
  toggleMobileNav: () => void;
  markRefreshed: (at?: number) => void;
  /** Open a short bypass-cache window for the next round of refetches. */
  requestForceRefresh: (windowMs?: number) => void;
  setOffline: (offline: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  addPanelOpen: false,
  editPanelPositionId: null,
  mobileNavOpen: false,
  lastRefreshAt: null,
  forceRefreshUntil: 0,
  isOffline: false,

  openAddPanel: () => set({ addPanelOpen: true }),
  closeAddPanel: () => set({ addPanelOpen: false }),
  openEditPanel: (positionId) => set({ editPanelPositionId: positionId }),
  closeEditPanel: () => set({ editPanelPositionId: null }),
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
  toggleMobileNav: () =>
    set((s) => ({ mobileNavOpen: !s.mobileNavOpen })),
  markRefreshed: (at = Date.now()) => set({ lastRefreshAt: at }),
  // ~15s comfortably covers a page's parallel provider round-trips; the
  // window then closes so background / focus / 60s auto refetches go back to
  // the quota-safe cached path.
  requestForceRefresh: (windowMs = 15_000) =>
    set({ forceRefreshUntil: Date.now() + windowMs }),
  setOffline: (offline) => set({ isOffline: offline }),
}));
