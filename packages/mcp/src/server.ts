#!/usr/bin/env node
/**
 * @mvp/mcp — a minimal, dependency-free MCP stdio server exposing the
 * framework's DevX tools (docs/AI_NATIVE_DEVX.md §7,
 * docs/ARCHITECTURE_REFACTOR_PLAN.md §7 item 3). Implements just enough of
 * the MCP JSON-RPC surface (`initialize`, `tools/list`, `tools/call`) over
 * newline-delimited stdio, so it needs no `@modelcontextprotocol/sdk`
 * dependency.
 *
 * Run inside this repo:  pnpm mcp   (== pnpm --filter @mvp/mcp start)
 * Run once published:    npx @mvp/mcp   (the package's `bin`, built by
 *                         `pnpm --filter @mvp/mcp build`)
 * Wire either into an agent's MCP config as a stdio server command.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { devxTools } from "./tools";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TOOLS = devxTools();
const PROTOCOL_VERSION = "2024-11-05";

type RpcMessage = {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
};

function write(message: RpcMessage): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id: RpcMessage["id"], result: unknown): void {
  write({ jsonrpc: "2.0", id, result });
}

function fail(id: RpcMessage["id"], code: number, message: string): void {
  write({ jsonrpc: "2.0", id, error: { code, message } });
}

async function handle(msg: RpcMessage): Promise<void> {
  // Notifications (no id) get no response.
  const { id, method, params } = msg;
  if (method === "initialize") {
    reply(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "@mvp/mcp", version: "0.1.0" },
    });
    return;
  }
  if (method === "notifications/initialized" || method === "ping") {
    if (id !== undefined) reply(id, {});
    return;
  }
  if (method === "tools/list") {
    reply(id, {
      tools: TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
    return;
  }
  if (method === "tools/call") {
    const name = (params?.name as string) ?? "";
    const args = (params?.arguments as Record<string, unknown>) ?? {};
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) {
      fail(id, -32602, `unknown tool "${name}"`);
      return;
    }
    try {
      const result = await tool.handler(args, { root: ROOT });
      reply(id, {
        content: [{ type: "text", text: result.text }],
        isError: result.isError ?? false,
      });
    } catch (error) {
      reply(id, {
        content: [{ type: "text", text: `tool error: ${String(error)}` }],
        isError: true,
      });
    }
    return;
  }
  if (id !== undefined) fail(id, -32601, `method not found: ${method}`);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let newline = buffer.indexOf("\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\n");
    if (!line) continue;
    try {
      void handle(JSON.parse(line) as RpcMessage);
    } catch {
      // Ignore unparseable lines rather than crash the server.
    }
  }
});
