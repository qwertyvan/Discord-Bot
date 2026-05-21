const PATTERN = /^(\d+)\s*([smhdw])$/i;
const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 } as const;

export function parseDuration(input: string): number | null {
  const match = PATTERN.exec(input.trim());
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2]!.toLowerCase() as keyof typeof UNIT_MS;
  return value * UNIT_MS[unit];
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}
