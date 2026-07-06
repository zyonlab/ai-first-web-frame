export type CliOptions = {
  ci: boolean;
  warnOnly: boolean;
  root?: string;
  threshold?: number;
  scope?: string;
  force: boolean;
  type?: string;
  budget?: string;
  stats?: string;
  css?: string;
  positional: string[];
};

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    ci: false,
    warnOnly: false,
    force: false,
    positional: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
    } else if (arg === "--ci") {
      options.ci = true;
    } else if (arg === "--warn-only") {
      options.warnOnly = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg.startsWith("--threshold=")) {
      options.threshold = Number(arg.slice("--threshold=".length));
    } else if (arg === "--threshold") {
      options.threshold = Number(argv[++index]);
    } else if (arg.startsWith("--root=")) {
      options.root = arg.slice("--root=".length);
    } else if (arg === "--root") {
      options.root = argv[++index];
    } else if (arg.startsWith("--scope=")) {
      options.scope = arg.slice("--scope=".length);
    } else if (arg === "--scope") {
      options.scope = argv[++index];
    } else if (arg.startsWith("--type=")) {
      options.type = arg.slice("--type=".length);
    } else if (arg === "--type") {
      options.type = argv[++index];
    } else if (arg.startsWith("--budget=")) {
      options.budget = arg.slice("--budget=".length);
    } else if (arg === "--budget") {
      options.budget = argv[++index];
    } else if (arg.startsWith("--stats=")) {
      options.stats = arg.slice("--stats=".length);
    } else if (arg === "--stats") {
      options.stats = argv[++index];
    } else if (arg.startsWith("--css=")) {
      options.css = arg.slice("--css=".length);
    } else if (arg === "--css") {
      options.css = argv[++index];
    } else {
      options.positional.push(arg);
    }
  }

  return options;
}
