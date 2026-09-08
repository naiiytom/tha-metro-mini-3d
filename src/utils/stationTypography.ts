import type { PrimaryLanguage } from "../stores/useAppStore";

export interface StationNameSource {
  name_en?: string;
  name_th?: string;
  name?: string;
  nameTh?: string;
  code?: string;
}

export interface FormattedStationTypography {
  primaryName: string;
  secondaryName: string;
  subtitle: string;
}

/**
 * Resolves simultaneous dual-line bilingual station typography given a station record
 * and the user's preferred primary language ('en' or 'th').
 */
export function formatBilingualStation(
  station: StationNameSource,
  primaryLang: PrimaryLanguage = "en",
): FormattedStationTypography {
  const en = station.name_en ?? station.name ?? "";
  const th = station.name_th ?? station.nameTh ?? "";
  const code = station.code ?? "";

  const isTh = primaryLang === "th";
  const primaryName = isTh && th ? th : en || th;
  const secondaryName = isTh ? en : th;

  let subtitle = secondaryName;
  if (code) {
    subtitle = secondaryName ? `${secondaryName} • ${code}` : code;
  }

  return {
    primaryName,
    secondaryName,
    subtitle,
  };
}
