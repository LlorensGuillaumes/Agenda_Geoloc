import type { Alarm, Place } from '../api/client';

function formatDateTimeShort(iso: string, lang: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(lang, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function formatTime(iso: string, lang: string): string {
  return new Intl.DateTimeFormat(lang, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function formatTimePart(
  cfg: NonNullable<Alarm['timeConfig']>,
  lang: string,
  weekdayInitials: string[],
  every: string,
): string {
  if (cfg.repeat === 'once' && cfg.datetime) {
    return formatDateTimeShort(cfg.datetime, lang);
  }
  if (cfg.repeat === 'daily' && cfg.datetime) {
    return `${every} · ${formatTime(cfg.datetime, lang)}`;
  }
  if (cfg.repeat === 'weekly' && cfg.datetime) {
    const days = (cfg.weekdays ?? [])
      .map((d) => weekdayInitials[d === 0 ? 6 : d - 1])
      .join(' ');
    return `${days || '—'} · ${formatTime(cfg.datetime, lang)}`;
  }
  return '';
}

function formatLocationPart(
  alarm: Alarm,
  places: Place[],
  unknownPlaceLabel: string,
  customPointLabel: string,
  whenLabels: { enter: string; exit: string; nearby: string },
): string {
  const cfg = alarm.locationConfig;
  if (!cfg) return '';
  let placeStr: string;
  if (cfg.mode === 'saved_place') {
    const place = cfg.placeId ? places.find((p) => p.id === cfg.placeId) : undefined;
    placeStr = place?.name ?? unknownPlaceLabel;
  } else {
    placeStr = customPointLabel;
  }
  const whenStr =
    cfg.event === 'enter'
      ? whenLabels.enter
      : cfg.event === 'exit'
        ? whenLabels.exit
        : whenLabels.nearby;
  return `${placeStr} · ${whenStr}`;
}

export type FormatAlarmDeps = {
  places: Place[];
  lang: string;
  weekdayInitials: string[];
  every: string;
  unknownPlaceLabel: string;
  customPointLabel: string;
  whenLabels: { enter: string; exit: string; nearby: string };
};

/**
 * Resumen de un solo string para mostrar bajo el título en la lista de
 * alarmas. Para `time_and_location`, encadena ubicación · evento · tiempo.
 */
export function formatAlarmSummary(alarm: Alarm, deps: FormatAlarmDeps): string {
  if (alarm.triggerType === 'time') {
    return alarm.timeConfig
      ? formatTimePart(alarm.timeConfig, deps.lang, deps.weekdayInitials, deps.every)
      : '';
  }

  if (alarm.triggerType === 'location') {
    return formatLocationPart(
      alarm,
      deps.places,
      deps.unknownPlaceLabel,
      deps.customPointLabel,
      deps.whenLabels,
    );
  }

  // time_and_location
  const locStr = formatLocationPart(
    alarm,
    deps.places,
    deps.unknownPlaceLabel,
    deps.customPointLabel,
    deps.whenLabels,
  );
  const timeStr = alarm.timeConfig
    ? formatTimePart(alarm.timeConfig, deps.lang, deps.weekdayInitials, deps.every)
    : '';
  return [locStr, timeStr].filter(Boolean).join(' · ');
}
