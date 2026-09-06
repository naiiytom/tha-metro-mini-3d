/**
 * Train model sizing and scale preference persistence (GitHub issue #5).
 *
 * Provides configurable train model scaling (1x realistic, 1.5x large, 2x extra-large)
 * so users can adjust visibility at overview zooms and on small mobile screens.
 */

export type TrainScale = 1 | 1.5 | 2;

export interface TrainScaleOption {
  scale: TrainScale;
  label: string;
  hint: string;
}

export const TRAIN_SCALES: readonly TrainScaleOption[] = [
  { scale: 1, label: "1x", hint: "Standard scale — 1:1 realistic train dimensions" },
  { scale: 1.5, label: "1.5x", hint: "Large scale — +50% visibility at overview zooms" },
  { scale: 2, label: "2x", hint: "Double scale — maximum visibility for high altitudes and small screens" },
];

export const TRAIN_SCALE_KEY = "tmm3d.view.trainScale";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

const NOOP_STORAGE: WritableStorage & ReadableStorage = {
  getItem: () => null,
  setItem: () => {},
};

export function browserStorage(): WritableStorage & ReadableStorage {
  try {
    return localStorage;
  } catch {
    return NOOP_STORAGE;
  }
}

export function parseTrainScale(raw: string | null): TrainScale {
  if (raw === "1.5") return 1.5;
  if (raw === "2") return 2;
  return 1;
}

export function loadTrainScale(storage: ReadableStorage = browserStorage()): TrainScale {
  try {
    return parseTrainScale(storage.getItem(TRAIN_SCALE_KEY));
  } catch {
    return 1;
  }
}

export function saveTrainScale(
  scale: TrainScale,
  storage: WritableStorage = browserStorage(),
): void {
  try {
    storage.setItem(TRAIN_SCALE_KEY, String(scale));
  } catch {
    // Storage quota or security error; preference simply not persisted.
  }
}
