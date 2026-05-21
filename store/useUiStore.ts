// Transient client-only UI state (Tech_Stack.md §State management): slide-in
// panel open/close, mobile nav, last manual-refresh timestamp, offline flag.
// Server data is owned by TanStack Query, never mirrored here.
//
// Most fields stay transient (recomputed every session). The sidebar collapse
// preference is the one exception — DECISIONS.md [G-B-11] persists it
// per-user via localStorage so the layout sticks across reloads.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

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
  /** Desktop sidebar collapsed-to-icons state. Persisted. */
  sidebarCollapsed: boolean;

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
  toggleSidebarCollapsed: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      addPanelOpen: false,
      editPanelPositionId: null,
      mobileNavOpen: false,
      lastRefreshAt: null,
      forceRefreshUntil: 0,
      isOffline: false,
      sidebarCollapsed: false,

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
      toggleSidebarCollapsed: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
    }),
    {
      name: "spm-ui",
      storage: createJSONStorage(() => localStorage),
      // Only persist the sidebar collapse preference. Everything else is
      // transient session state.
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed }),
    },
  ),
);
