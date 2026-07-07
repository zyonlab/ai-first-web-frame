/**
 * Pure countdown helpers for the funding bar. These are the only "logic" units
 * and are fully deterministic given an explicit `now` — no clock, no DOM. The
 * SSR render seeds a `<time>` label from these; an optional tiny vanilla script
 * recomputes the same label client-side without any framework.
 */

/** Milliseconds remaining until the next funding settlement (clamped at 0). */
export function fundingCountdownMs(now: number, nextFundingTs: number): number {
  return Math.max(0, nextFundingTs - now);
}

/**
 * Formats a millisecond duration as a stable `HH:MM:SS` countdown label.
 * Hours are not capped (an 8h+ interval still renders as e.g. `08:00:00`).
 */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

/** Convenience: countdown label from `now` + `nextFundingTs` in one call. */
export function fundingCountdownLabel(
  now: number,
  nextFundingTs: number,
): string {
  return formatCountdown(fundingCountdownMs(now, nextFundingTs));
}

/**
 * Semantic sign of a funding rate → an up/down/flat token the render maps to a
 * CSS class (up = longs pay shorts / positive, down = negative, flat = zero).
 */
export function fundingRateDirection(rate: number): "up" | "down" | "flat" {
  if (rate > 0) return "up";
  if (rate < 0) return "down";
  return "flat";
}

/** Formats a funding rate as a signed percentage string (e.g. `+0.0100%`). */
export function formatFundingRate(rate: number, decimals = 4): string {
  const pct = rate * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(decimals)}%`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
