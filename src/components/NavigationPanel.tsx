import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useIsMobile } from "../hooks/useIsMobile";
import { useBottomSheet } from "../hooks/useBottomSheet";
import { useAppStore, type NavigationTab } from "../stores/useAppStore";
import { browserStorage, hasStoredPreference, loadCollapsed, saveCollapsed } from "./panelCollapse";
import { LinesTab } from "./tabs/LinesTab";
import { StationsTab } from "./tabs/StationsTab";
import { RouteTab } from "./tabs/RouteTab";
import { AboutTab } from "./tabs/AboutTab";

interface TabItem {
  id: NavigationTab;
  label: string;
  icon: string;
  description: string;
}

const TABS: TabItem[] = [
  { id: "lines", label: "Lines", icon: "🚇", description: "Lines & view controls" },
  { id: "stations", label: "Stations", icon: "🔍", description: "Find stations & departures" },
  { id: "route", label: "Route", icon: "🧭", description: "Plan a journey" },
  { id: "about", label: "About", icon: "ℹ️", description: "Attribution & sponsors" },
];

export function NavigationPanel() {
  const mapReady = useAppStore((s) => s.mapReady);
  const uiHidden = useAppStore((s) => s.uiHidden);
  const setUiHidden = useAppStore((s) => s.setUiHidden);
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const primaryLang = useAppStore((s) => s.primaryLang);
  const togglePrimaryLang = useAppStore((s) => s.togglePrimaryLang);
  const isMobile = useIsMobile();
  const sheetDetent = useAppStore((s) => s.sheetDetent);
  const setSheetDetent = useAppStore((s) => s.setSheetDetent);
  const selectedStation = useAppStore((s) => s.selectedStation);
  const selectedRunIdx = useAppStore((s) => s.selectedRunIdx);

  const { sheetRef, handleRef, contentRef, snapTo, translateY } = useBottomSheet({
    initialDetent: sheetDetent,
    onDetentChange: setSheetDetent,
  });

  const [expanded, setExpanded] = useState(() => !loadCollapsed(browserStorage(), isMobile));
  const lastActiveTab = useRef<NavigationTab>("lines");
  const tabRefs = useRef<{ [key in NavigationTab]?: HTMLButtonElement | null }>({});

  useEffect(() => {
    if (activeTab !== null) {
      lastActiveTab.current = activeTab;
      setExpanded(true);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!hasStoredPreference(browserStorage())) setExpanded(!isMobile);
  }, [isMobile]);

  useEffect(() => {
    if (isMobile) {
      snapTo(sheetDetent);
    }
  }, [isMobile, sheetDetent, snapTo]);

  const toggleExpanded = () => {
    const next = !expanded;
    saveCollapsed(browserStorage(), !next);
    setExpanded(next);
    if (next) {
      setActiveTab(lastActiveTab.current || "lines");
    } else {
      setActiveTab(null);
    }
  };

  const handleTabClick = (tabId: NavigationTab) => {
    if (isMobile) {
      if (sheetDetent === "peek") {
        snapTo("half");
      }
      setActiveTab(tabId);
      return;
    }
    if (!expanded) {
      setExpanded(true);
      saveCollapsed(browserStorage(), false);
      setActiveTab(tabId);
      return;
    }
    if (activeTab === tabId) {
      // Toggle collapsed state when clicking the already-active tab
      saveCollapsed(browserStorage(), true);
      setExpanded(false);
      setActiveTab(null);
    } else {
      setActiveTab(tabId);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const currentIdx = TABS.findIndex((t) => t.id === (activeTab || lastActiveTab.current || "lines"));
    if (currentIdx === -1) return;

    let targetIdx = -1;
    if (e.key === "ArrowRight") {
      targetIdx = (currentIdx + 1) % TABS.length;
    } else if (e.key === "ArrowLeft") {
      targetIdx = (currentIdx - 1 + TABS.length) % TABS.length;
    } else if (e.key === "Home") {
      targetIdx = 0;
    } else if (e.key === "End") {
      targetIdx = TABS.length - 1;
    }

    if (targetIdx !== -1) {
      e.preventDefault();
      const targetTab = TABS[targetIdx].id;
      setExpanded(true);
      saveCollapsed(browserStorage(), false);
      setActiveTab(targetTab);
      tabRefs.current[targetTab]?.focus();
    }
  };

  const hasMobileInspection = isMobile && (selectedStation !== null || selectedRunIdx !== null);
  if (hasMobileInspection) return null;

  const bodyVisible = (isMobile || expanded) && activeTab !== null && !uiHidden;
  const currentTab = activeTab || lastActiveTab.current || "lines";

  return (
    <nav
      ref={isMobile ? sheetRef : undefined}
      aria-label="Transit Navigation"
      data-testid="navigation-panel"
      style={isMobile && translateY !== undefined ? { transform: `translateY(${translateY}px)` } : undefined}
      className={`panel-glass pointer-events-auto overflow-hidden transition-all ${
        isMobile
          ? "fixed inset-x-0 bottom-0 z-30 flex h-[85dvh] max-h-[85dvh] w-full flex-col rounded-t-[28px] rounded-b-none border-t border-edge border-x-0 border-b-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          : `absolute left-4 top-4 z-20 rounded-2xl border max-h-[calc(100dvh-2rem)] ${
              expanded ? "w-88" : "w-12"
            }`
      } ${uiHidden ? (isMobile ? "translate-y-full" : "hidden") : ""}`}
    >
      {/* Mobile Drag Handle */}
      {isMobile && (
        <div
          ref={handleRef}
          data-testid="bottom-sheet-handle"
          className="flex justify-center pt-2.5 pb-1 cursor-grab touch-none select-none"
        >
          <div className="h-1.5 w-10 rounded-full bg-ink-subtle/40 hover:bg-ink-subtle/60 transition-colors" />
        </div>
      )}

      {/* Header — shown on mobile, and on desktop only when expanded */}
      {(isMobile || expanded) && (
        <div className="flex items-center justify-between gap-2 border-b border-edge px-3.5 py-2">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-ink">Greater Bangkok Metro Mini 3D</h1>
            <p className="truncate text-xs text-ink-muted">
              {mapReady
                ? primaryLang === "th"
                  ? "ระบบจำลองรถไฟฟ้ากรุงเทพมหานครและปริมณฑล"
                  : "Bangkok Urban Rail Simulation"
                : "Loading map…"}
            </p>
          </div>

          {/* 1-tap Language Switcher */}
          <button
            type="button"
            onClick={togglePrimaryLang}
            aria-label={`Switch language (current: ${primaryLang.toUpperCase()})`}
            title={`Switch language (current: ${primaryLang.toUpperCase()})`}
            className="flex h-11 min-h-[44px] shrink-0 items-center justify-center rounded-full border border-edge bg-surface-sunken/80 px-2 text-[11px] font-bold text-ink hover:bg-surface md:h-8 md:min-h-0"
          >
            {primaryLang === "en" ? "EN / TH" : "TH / EN"}
          </button>

          {/* Mobile Hide UI Toggle */}
          <button
            type="button"
            onClick={() => setUiHidden(!uiHidden)}
            aria-label={uiHidden ? "Show overlay UI" : "Hide overlay UI"}
            title={uiHidden ? "Show overlay UI" : "Hide overlay UI"}
            className="flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-sm text-ink-muted hover:bg-surface-sunken md:h-8 md:w-8 md:min-h-0 md:min-w-0"
          >
            {uiHidden ? "👁️" : "✕"}
          </button>

          {/* Desktop Collapse Toggle */}
          <button
            type="button"
            onClick={toggleExpanded}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse navigation panel" : "Expand navigation panel"}
            title={expanded ? "Collapse panel" : "Expand panel"}
            className="hidden md:flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold text-ink-muted hover:bg-surface-sunken"
          >
            ▲
          </button>
        </div>
      )}

      {/* Desktop Slim Rail Expand Button (shown only when collapsed on desktop) */}
      {!isMobile && !expanded && (
        <div className="flex justify-center pt-2 pb-1 border-b border-edge">
          <button
            type="button"
            onClick={toggleExpanded}
            aria-expanded={false}
            aria-label="Expand navigation panel"
            title="Expand panel"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-semibold text-ink-muted hover:bg-surface-sunken hover:text-ink"
          >
            ▼
          </button>
        </div>
      )}

      {/* Accessible Tab Bar */}
      <div
        role="tablist"
        aria-label="Navigation Sections"
        onKeyDown={handleKeyDown}
        className={`flex ${
          isMobile || expanded ? "flex-row border-b" : "flex-col gap-1 py-1"
        } border-edge bg-surface-sunken/60 p-1`}
      >
        {TABS.map((tab) => {
          const isSelected = (isMobile || expanded) && activeTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[tab.id] = el;
              }}
              role="tab"
              id={`tab-${tab.id}`}
              aria-label={tab.label}
              aria-selected={isSelected}
              aria-controls={`tabpanel-${tab.id}`}
              tabIndex={isSelected || (!expanded && tab.id === "lines") ? 0 : -1}
              onClick={() => handleTabClick(tab.id)}
              title={tab.description}
              className={`flex items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-all ${
                isMobile || expanded
                  ? "flex-1 min-h-[44px] py-2 md:min-h-0 md:py-1.5"
                  : "h-9 w-9 p-0 mx-auto"
              } ${
                isSelected
                  ? "bg-surface text-ink shadow-sm ring-1 ring-edge"
                  : "text-ink-muted hover:bg-surface/50 hover:text-ink"
              }`}
            >
              <span className="text-base leading-none md:text-sm">{tab.icon}</span>
              {(isMobile || expanded) && <span className="hidden sm:inline">{tab.label}</span>}
            </button>
          );
        })}
      </div>

      {/* Active Tab Panel Body */}
      {bodyVisible && (
        <div
          ref={isMobile ? contentRef : undefined}
          role="tabpanel"
          id={`tabpanel-${currentTab}`}
          aria-labelledby={`tab-${currentTab}`}
          className="flex-1 overflow-y-auto overscroll-contain p-2 md:max-h-[calc(100dvh-8rem)]"
        >
          {currentTab === "lines" && <LinesTab />}
          {currentTab === "stations" && <StationsTab />}
          {currentTab === "route" && <RouteTab />}
          {currentTab === "about" && <AboutTab />}
        </div>
      )}
    </nav>
  );
}

