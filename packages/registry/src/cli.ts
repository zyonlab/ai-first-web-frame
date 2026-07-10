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
