export type CliArgs = {
  flags: Record<string, string | boolean>;
  positional: string[];
};

export function parseCliArgs(argv: string[]): CliArgs {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const equals = body.indexOf("=");
    if (equals >= 0) {
      flags[body.slice(0, equals)] = body.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags[body] = true;
    } else {
      flags[body] = next;
      index += 1;
    }
  }

  return { flags, positional };
}

export function stringFlag(args: CliArgs, name: string): string | undefined {
  const value = args.flags[name];
  return typeof value === "string" ? value : undefined;
}

export function booleanFlag(args: CliArgs, name: string): boolean {
  return args.flags[name] === true || args.flags[name] === "true";
}

/**
 * Rejects flags outside a script's declared allowlist (audit contract L3).
 * `parseCliArgs` itself accepts any `--flag`, so a typo like `--chanel canary`
 * used to be silently ignored and the script proceeded with defaults. Each
 * lifecycle script passes its known flag names here right after parsing and
 * fails (`{status: "failed"}`, exit 1, no writes) on the returned message.
 *
 * Returns the first unknown flag as an error string — with a
 * "did you mean --<flag>?" suggestion when a known flag is a close match —
 * or `undefined` when every flag is known.
 */
export function unknownFlagError(
  args: CliArgs,
  knownFlags: readonly string[],
): string | undefined {
  const known = new Set(knownFlags);
  for (const flag of Object.keys(args.flags)) {
    if (known.has(flag)) continue;
    const suggestion = suggestFlag(flag, knownFlags);
    return suggestion
      ? `unknown flag --${flag} (did you mean --${suggestion}?)`
      : `unknown flag --${flag}`;
  }
  return undefined;
}

/** Nearest known flag: levenshtein distance <= 2, else a prefix match. */
function suggestFlag(
  flag: string,
  knownFlags: readonly string[],
): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const candidate of knownFlags) {
    const distance = levenshtein(flag, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  if (best) return best;
  if (flag.length >= 3) {
    return knownFlags.find((candidate) => candidate.startsWith(flag));
  }
  return undefined;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}
