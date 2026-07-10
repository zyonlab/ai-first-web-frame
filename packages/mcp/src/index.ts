/**
 * @mvp/mcp library entry point — the tool registry without the stdio
 * transport, for programmatic use (tests, scripts, other servers embedding
 * the same tools). The stdio MCP server itself is `src/server.ts` (the
 * package's `bin`).
 */
export * from "./tools";
