"use client";

import type { ThemeName } from "@mvp/design-system";
import { cn } from "./cn";

/**
 * ThemeToggle — a small token demo component (doc 04 deliverable). Pure UI +
 * callback props: it does NOT own theme state or touch `document` here; a P3
 * store binding will pass `theme` + `onThemeChange`. It renders a two-option
 * light/dark segmented control styled entirely with `var(--mvp-*)` token
 * utilities, so it recolors with the same `data-theme` flip it toggles.
 *
 * Implemented as `aria-pressed` toggle buttons in a labelled group (the shadcn
 * Toggle pattern) rather than a native radio group, so the token pill styling
 * survives while staying keyboard- and screen-reader-accessible.
 */

export type ThemeToggleProps = {
  /** Current theme (controlled). */
  theme: ThemeName;
  /** Called with the next theme when the user flips the toggle. */
  onThemeChange: (next: ThemeName) => void;
  className?: string;
};

const OPTIONS: ThemeName[] = ["light", "dark"];

export function ThemeToggle({
  theme,
  onThemeChange,
  className,
}: ThemeToggleProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-xs rounded-md border border-border bg-surface-1 p-xs",
        className,
      )}
    >
      {OPTIONS.map((option) => {
        const selected = option === theme;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            aria-label={option}
            onClick={() => onThemeChange(option)}
            className={cn(
              "rounded-sm px-md py-xs text-sm font-medium capitalize transition-colors",
              selected
                ? "bg-surface-2 text-ink shadow-raised"
                : "text-text-muted hover:text-ink",
            )}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
