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
  { id: "lines", label: "Lines", icon: "ðŸš‡", description: "Lines & view controls" },
  { id: "stations", label: "Stations", icon: "ðŸ”", description: "Find stations & departures" },
  { id: "route", label: "Route", icon: "ðŸ§­", description: "Plan a journey" },
  { id: "about", label: "About", icon: "â„¹ï¸", description: "Attribution & sponsors" },
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

  const { sheetRef, handleRef, contentRef, translateY } = useBottomSheet({
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

  const bodyVisible = expanded && activeTab !== null && !uiHidden;
  const currentTab = activeTab || lastActiveTab.current || "lines";

  return (
    <nav
      ref={isMobile ? sheetRef : undefined}
      aria-label="Transit Navigation"
      data-testid="navigation-panel"
      style={isMobile && translateY ? { transform: `translateY(${translateY}px)` } : undefined}
      className={`panel-glass pointer-events-auto absolute left-[max(1rem,env(safe-area-inset-left))] top-4 overflow-hidden rounded-2xl border shadow-xl shadow-ink/10 backdrop-blur-xl md:left-4 md:max-h-[calc(100dvh-2rem)] ${
        isMobile
          ? "max-h-[calc(100dvh-16rem)] w-[min(22rem,calc(100vw-2rem))]"
          : expanded
            ? "w-88"
            : "w-12"
      }`}
    >
      {/* Mobile Drag Handle */}
      <div
        ref={isMobile ? handleRef : undefined}
        data-testid="bottom-sheet-handle"
        className="flex justify-center pt-2 pb-1 cursor-grab touch-none md:hidden"
      >
        <div className="h-1 w-10 rounded-full bg-ink-subtle/40" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-edge px-3.5 py-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-ink">Greater Bangkok Metro Mini 3D</h1>
          <p className="truncate text-xs text-ink-muted">
            {mapReady
              ? primaryLang === "th"
                ? "à¸£à¸°à¸šà¸šà¸ˆà¸³à¸¥à¸­à¸‡à¸£à¸–à¹„à¸Ÿà¸Ÿà¹‰à¸²à¸à¸£à¸¸à¸‡à¹€à¸—à¸žà¸¡à¸«à¸²à¸™à¸„à¸£à¹à¸¥à¸°à¸›à¸£à¸´à¸¡à¸“à¸‘à¸¥"
                : "Bangkok Urban Rail Simulation"
              : "Loading mapâ€¦"}
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
          {uiHidden ? "ðŸ‘ï¸" : "âœ•"}
        </button>

        {/* Collapse / Expand Toggle (desktop only — not shown on mobile) */}
        <button
          type="button"
          onClick={toggleExpanded}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse navigation panel" : "Expand navigation panel"}
          title={expanded ? "Collapse panel" : "Expand panel"}
          className="flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-xs font-semibold text-ink-muted hover:bg-surface-sunken md:h-8 md:w-8 md:min-h-0 md:min-w-0"
        >
          {expanded ? "â–²" : "â–¼"}
        </button>
      </div>

      {/* Accessible Tab Bar */}
      <div
        role="tablist"
        aria-label="Navigation Sections"
        onKeyDown={handleKeyDown}
        className="flex border-b border-edge bg-surface-sunken/60 p-1"
      >
        {TABS.map((tab) => {
          const isSelected = expanded && activeTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[tab.id] = el;
              }}
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={isSelected}
              aria-controls={`tabpanel-${tab.id}`}
              tabIndex={isSelected || (!expanded && tab.id === "lines") ? 0 : -1}
              onClick={() => handleTabClick(tab.id)}
              title={tab.description}
              className={`flex flex-1 min-h-[44px] items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-all md:min-h-0 md:py-1.5 ${
                isSelected
                  ? "bg-surface text-ink shadow-sm ring-1 ring-edge"
                  : "text-ink-muted hover:bg-surface/50 hover:text-ink"
              }`}
            >
              <span className="text-base leading-none md:text-sm">{tab.icon}</span>
              <span className="hidden sm:inline">{tab.label}</span>
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
          className="max-h-[calc(100dvh-22rem)] overflow-y-auto p-2 md:max-h-[calc(100dvh-8rem)]"
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


