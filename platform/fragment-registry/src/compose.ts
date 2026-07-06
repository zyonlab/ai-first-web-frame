export type ComposeMutation = {
  text: string;
  changed: boolean;
};

export function listComposeHostPorts(text: string): number[] {
  const ports: number[] = [];
  for (const match of text.matchAll(/-\s*"(\d+):\d+"/g)) {
    ports.push(Number(match[1]));
  }
  return ports;
}

export function nextFragmentPort(text: string, start = 4201): number {
  const used = new Set(listComposeHostPorts(text));
  let port = start;
  while (used.has(port)) port += 1;
  return port;
}

export function hasComposeService(text: string, name: string): boolean {
  return new RegExp(`^ {2}${escapeRegExp(name)}:\\s*$`, "m").test(text);
}

export function renderComposeService(name: string, port: number): string {
  return [
    `  ${name}:`,
    "    build:",
    "      context: ../..",
    `      dockerfile: fragments/${name}/Dockerfile`,
    "    ports:",
    `      - "${port}:${port}"`,
    "    environment:",
    `      PORT: "${port}"`,
    "",
  ].join("\n");
}

export function addComposeService(
  text: string,
  { name, port }: { name: string; port: number },
): ComposeMutation {
  if (hasComposeService(text, name)) return { text, changed: false };
  const usedPorts = listComposeHostPorts(text);
  if (usedPorts.includes(port))
    throw new Error(`host port ${port} is already used in docker-compose.yml`);
  const trimmed = text.replace(/\n+$/, "\n");
  return {
    text: `${trimmed}\n${renderComposeService(name, port)}`,
    changed: true,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
