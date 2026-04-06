export const DEFAULT_TERMINAL_WIDTH = 80;
export const MIN_TERMINAL_WIDTH = 20;

export function getTerminalWidth(columns?: number): number {
  return Math.max(MIN_TERMINAL_WIDTH, columns ?? process.stdout.columns ?? DEFAULT_TERMINAL_WIDTH);
}

export function getObservedTerminalWidth(...columns: Array<number | undefined>): number {
  const observed = columns.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  if (observed.length === 0) return DEFAULT_TERMINAL_WIDTH;
  return Math.max(MIN_TERMINAL_WIDTH, Math.min(...observed));
}

export function insetWidth(width: number, inset: number): number {
  return Math.max(1, width - inset);
}

export function truncateToWidth(value: string, maxWidth: number): string {
  if (maxWidth <= 1) return "…";
  return value.length <= maxWidth ? value : `${value.slice(0, maxWidth - 1).trimEnd()}…`;
}
