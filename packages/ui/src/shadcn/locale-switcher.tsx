"use client";

import { cn } from "./cn";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

/**
 * LocaleSwitcher — a small token demo component (doc 04 deliverable). Pure UI +
 * callback props over the token-styled `Select`; it holds no locale state (P3
 * store binding wires `locale` + `onLocaleChange`). Token-backed only.
 */

export type LocaleOption = {
  /** BCP-47 code, e.g. `en`, `zh-CN`. */
  value: string;
  /** Human-readable label, e.g. `English`, `简体中文`. */
  label: string;
};

export type LocaleSwitcherProps = {
  /** Current locale value (controlled). */
  locale: string;
  /** Selectable locales. */
  options: LocaleOption[];
  /** Called with the next locale code when the user picks one. */
  onLocaleChange: (next: string) => void;
  className?: string;
};

export function LocaleSwitcher({
  locale,
  options,
  onLocaleChange,
  className,
}: LocaleSwitcherProps) {
  return (
    <Select value={locale} onValueChange={onLocaleChange}>
      <SelectTrigger
        aria-label="Locale"
        className={cn("w-auto min-w-[8rem]", className)}
      >
        <SelectValue placeholder="Language" />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
