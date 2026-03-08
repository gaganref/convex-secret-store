export function formatAbsoluteTime(
  value: number | undefined,
  locale = "en-US",
) {
  if (value === undefined) {
    return "Never";
  }
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

export function formatRelativeTime(value: number | undefined, now = Date.now()) {
  if (value === undefined) {
    return "Never";
  }

  const deltaMs = value - now;
  const absMs = Math.abs(deltaMs);
  const absMinutes = Math.round(absMs / (60 * 1000));
  const absHours = Math.round(absMs / (60 * 60 * 1000));
  const absDays = Math.round(absMs / (24 * 60 * 60 * 1000));

  if (absMinutes < 60) {
    return deltaMs >= 0 ? `in ${absMinutes}m` : `${absMinutes}m ago`;
  }
  if (absHours < 48) {
    return deltaMs >= 0 ? `in ${absHours}h` : `${absHours}h ago`;
  }
  return deltaMs >= 0 ? `in ${absDays}d` : `${absDays}d ago`;
}

export function formatCountLabel(count: number, singular: string, plural?: string) {
  const resolvedPlural = plural ?? `${singular}s`;
  return `${count} ${count === 1 ? singular : resolvedPlural}`;
}
