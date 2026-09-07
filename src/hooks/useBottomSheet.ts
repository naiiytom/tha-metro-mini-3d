import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { SheetDetent } from "../stores/useAppStore";

export interface BottomSheetOptions {
  initialDetent?: SheetDetent;
  peekHeight?: number;       // default: 72px
  halfRatio?: number;        // default: 0.40 (40vh)
  fullRatio?: number;        // default: 0.85 (85vh)
  velocityThreshold?: number;// default: 0.45 px/ms
  onDetentChange?: (detent: SheetDetent) => void;
}

export interface BottomSheetReturn {
  detent: SheetDetent;
  setDetent: (detent: SheetDetent) => void;
  translateY: number;
  isDragging: boolean;
  sheetRef: RefObject<HTMLDivElement | null>;
  handleRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
}

export function getDetentY(
  d: SheetDetent,
  frameH: number,
  options: Pick<BottomSheetOptions, "peekHeight" | "halfRatio" | "fullRatio"> = {},
): number {
  const { peekHeight = 72, halfRatio = 0.4, fullRatio = 0.85 } = options;
  const sheetH = frameH * fullRatio;
  switch (d) {
    case "full":
      return 0;
    case "half":
      return Math.max(0, sheetH - frameH * halfRatio);
    case "peek":
      return Math.max(0, sheetH - peekHeight);
  }
}

export function applyRubberBand(nextY: number, minY: number, maxY: number): number {
  if (nextY < minY) {
    return minY - Math.pow(minY - nextY, 0.75);
  }
  if (nextY > maxY) {
    return maxY + Math.pow(nextY - maxY, 0.75);
  }
  return nextY;
}

export function calcTargetDetent(
  currentY: number,
  velocity: number,
  frameH: number,
  options: Pick<BottomSheetOptions, "peekHeight" | "halfRatio" | "fullRatio" | "velocityThreshold"> = {},
): SheetDetent {
  const { velocityThreshold = 0.45 } = options;
  const fullY = getDetentY("full", frameH, options);
  const halfY = getDetentY("half", frameH, options);
  const peekY = getDetentY("peek", frameH, options);

  if (velocity < -velocityThreshold) {
    return currentY > halfY ? "half" : "full";
  }
  if (velocity > velocityThreshold) {
    return currentY < halfY ? "half" : "peek";
  }

  const dFull = Math.abs(currentY - fullY);
  const dHalf = Math.abs(currentY - halfY);
  const dPeek = Math.abs(currentY - peekY);

  if (dFull <= dHalf && dFull <= dPeek) return "full";
  if (dHalf <= dFull && dHalf <= dPeek) return "half";
  return "peek";
}

/**
 * useBottomSheet: Zero-dependency gesture engine for multi-detent mobile sheets.
 * Runs on standard Pointer Events and direct CSS transforms without bundle overhead.
 */
export function useBottomSheet(options: BottomSheetOptions = {}): BottomSheetReturn {
  const {
    initialDetent = "half",
    peekHeight = 72,
    halfRatio = 0.4,
    fullRatio = 0.85,
    velocityThreshold = 0.45,
    onDetentChange,
  } = options;

  const [detent, setDetentState] = useState<SheetDetent>(initialDetent);
  const [translateY, setTranslateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const sheetRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const dragStartRef = useRef<{
    startY: number;
    initialTranslateY: number;
    lastY: number;
    lastTime: number;
    velocity: number;
  }>({
    startY: 0,
    initialTranslateY: 0,
    lastY: 0,
    lastTime: 0,
    velocity: 0,
  });

  const snapTo = useCallback(
    (nextDetent: SheetDetent) => {
      const sheet = sheetRef.current;
      if (!sheet) return;
      const frameH = typeof window !== "undefined" ? window.innerHeight : 800;
      const targetY = getDetentY(nextDetent, frameH, { peekHeight, halfRatio, fullRatio });

      sheet.style.transition = "transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)";
      sheet.style.transform = `translateY(${targetY}px)`;
      setTranslateY(targetY);
      setDetentState(nextDetent);
      onDetentChange?.(nextDetent);
    },
    [halfRatio, fullRatio, onDetentChange, peekHeight],
  );

  useEffect(() => {
    const handleEl = handleRef.current;
    const sheetEl = sheetRef.current;
    const contentEl = contentRef.current;
    if (!handleEl || !sheetEl) return;

    const onPointerDown = (e: PointerEvent) => {
      if (contentEl && contentEl.contains(e.target as Node)) {
        if (detent === "full" && contentEl.scrollTop > 0) return;
      }

      setIsDragging(true);
      const frameH = window.innerHeight;
      const initialY = getDetentY(detent, frameH, { peekHeight, halfRatio, fullRatio });

      dragStartRef.current = {
        startY: e.clientY,
        initialTranslateY: initialY,
        lastY: e.clientY,
        lastTime: performance.now(),
        velocity: 0,
      };

      sheetEl.style.transition = "none";
      sheetEl.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!sheetEl.hasPointerCapture(e.pointerId)) return;

      const { startY, initialTranslateY, lastY, lastTime } = dragStartRef.current;
      const deltaY = e.clientY - startY;
      const now = performance.now();
      const dt = now - lastTime;

      if (dt > 10) {
        dragStartRef.current.velocity = (e.clientY - lastY) / dt;
        dragStartRef.current.lastY = e.clientY;
        dragStartRef.current.lastTime = now;
      }

      const frameH = window.innerHeight;
      const minY = getDetentY("full", frameH, { peekHeight, halfRatio, fullRatio });
      const maxY = getDetentY("peek", frameH, { peekHeight, halfRatio, fullRatio });

      const nextY = applyRubberBand(initialTranslateY + deltaY, minY, maxY);
      sheetEl.style.transform = `translateY(${nextY}px)`;
      setTranslateY(nextY);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!sheetEl.hasPointerCapture(e.pointerId)) return;
      sheetEl.releasePointerCapture(e.pointerId);
      setIsDragging(false);

      const frameH = window.innerHeight;
      const currentY = translateY;
      const vel = dragStartRef.current.velocity;

      const target = calcTargetDetent(currentY, vel, frameH, {
        peekHeight,
        halfRatio,
        fullRatio,
        velocityThreshold,
      });

      snapTo(target);
    };

    handleEl.addEventListener("pointerdown", onPointerDown);
    sheetEl.addEventListener("pointermove", onPointerMove);
    sheetEl.addEventListener("pointerup", onPointerUp);
    sheetEl.addEventListener("pointercancel", onPointerUp);

    return () => {
      handleEl.removeEventListener("pointerdown", onPointerDown);
      sheetEl.removeEventListener("pointermove", onPointerMove);
      sheetEl.removeEventListener("pointerup", onPointerUp);
      sheetEl.removeEventListener("pointercancel", onPointerUp);
    };
  }, [detent, fullRatio, halfRatio, peekHeight, snapTo, translateY, velocityThreshold]);

  return {
    detent,
    setDetent: snapTo,
    translateY,
    isDragging,
    sheetRef,
    handleRef,
    contentRef,
  };
}
