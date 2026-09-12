import { useEffect, useState } from "react";
import type { RunDetail } from "../sim/protocol";
import { activeSimClient } from "../sim/SimClient";
import { useAppStore } from "../stores/useAppStore";
import { useT } from "../i18n";

export interface FollowHudChipProps {
  lineName?: string;
  lineColor?: string;
  trainId?: string | number;
  speedKmh?: number;
  onUnfollow?: () => void;
  onCenter?: () => void;
}

export function FollowHudChip({
  lineName,
  lineColor,
  trainId,
  speedKmh,
  onUnfollow,
  onCenter,
}: FollowHudChipProps = {}) {
  const following = useAppStore((s) => s.following);
  const selectedRunIdx = useAppStore((s) => s.selectedRunIdx);
  const setFollowing = useAppStore((s) => s.setFollowing);
  const routes = useAppStore((s) => s.routes);
  const primaryLang = useAppStore((s) => s.primaryLang);
  const t = useT();
  const [detail, setDetail] = useState<RunDetail | null>(null);

  useEffect(() => {
    if (!following || selectedRunIdx === null) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const client = activeSimClient.current;
      if (!client) return;
      try {
        const d = await client.getRunDetail(selectedRunIdx, client.getSimNow());
        if (!cancelled) setDetail(d);
      } catch {
        // SimClient torn down or busy
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [following, selectedRunIdx]);

  if (!following) return null;

  const displayTrainId = trainId ?? selectedRunIdx ?? "";
  const fallbackLineName =
    detail?.route_idx !== undefined && routes[detail.route_idx]
      ? (primaryLang === "th" && routes[detail.route_idx]?.nameTh
          ? routes[detail.route_idx]?.nameTh
          : routes[detail.route_idx]?.name)
      : (detail?.route_name ?? t("follow.trainFallback"));

  const resolvedLineName = lineName ?? fallbackLineName;

  const displayLine = lineName
    ? `${lineName} #${displayTrainId}`
    : `${resolvedLineName} #${displayTrainId}`;

  const resolvedLineColor =
    lineColor ??
    (detail ? `#${detail.color_rgb.toString(16).padStart(6, "0")}` : undefined);

  const resolvedSpeed =
    speedKmh !== undefined
      ? speedKmh
      : detail
        ? detail.state === 0
          ? 0
          : 56
        : undefined;

  const handleUnfollow = () => {
    if (onUnfollow) {
      onUnfollow();
    } else {
      setFollowing(false);
    }
  };

  const handleCenter = () => {
    if (onCenter) {
      onCenter();
    } else if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("recenter-follow-camera"));
    }
  };

  return (
    <div
      data-testid="follow-hud-chip"
      className="panel-glass pointer-events-auto fixed top-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2 rounded-full text-xs shadow-lg animate-in fade-in duration-200"
      role="region"
      aria-label={t("follow.statusAriaLabel")}
    >
      <span
        className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0"
        aria-hidden="true"
        style={resolvedLineColor ? { backgroundColor: resolvedLineColor } : undefined}
      />
      <span className="font-semibold text-ink truncate max-w-48 sm:max-w-64">
        {displayLine}
      </span>
      {resolvedSpeed !== undefined && (
        <span className="text-ink-muted tabular-nums font-mono">
          {t("follow.speedKmh", { speed: resolvedSpeed })}
        </span>
      )}
      <button
        type="button"
        onClick={handleCenter}
        aria-label={t("follow.recenterAria")}
        title={t("follow.recenterTitle")}
        className="rounded-full px-2 py-0.5 text-ink-muted hover:text-ink hover:bg-surface-sunken transition-colors font-medium"
      >
        {t("follow.recenter")}
      </button>
      <button
        type="button"
        onClick={handleUnfollow}
        aria-label={t("follow.unfollowAria")}
        className="rounded-full px-2 py-0.5 font-bold text-ink-muted hover:text-ink hover:bg-surface-sunken transition-colors"
      >
        {t("follow.unfollow")}
      </button>
    </div>
  );
}
