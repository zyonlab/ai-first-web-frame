import { describe, expect, it } from "vitest";
import {
  checkDemosBlockFreshness,
  DEMOS_BLOCK_BEGIN,
  DEMOS_BLOCK_END,
  extractDemosBlock,
  MissingDemosMarkersError,
  type PageDemosEntry,
  renderDemosBlock,
  replaceDemosBlock,
} from "./demos-block";

const entries: PageDemosEntry[] = [
  {
    page: "page-trade",
    route: "/trade/:symbol",
    demonstrates: ["dag-scheduling", "layout-hints"],
  },
  { page: "page-home", route: "/", demonstrates: ["trace-panel"] },
  { page: "page-vaults", route: "/vaults", demonstrates: [] },
];

function docWithBlock(block: string): string {
  return `# DEMOS\n\nintro prose\n\n${block}\n\ntrailing prose\n`;
}

describe("renderDemosBlock", () => {
  it("renders one row per page, sorted by page name, markers included", () => {
    const block = renderDemosBlock(entries);
    expect(block.startsWith(DEMOS_BLOCK_BEGIN)).toBe(true);
    expect(block.endsWith(DEMOS_BLOCK_END)).toBe(true);
    const rows = block
      .split("\n")
      .filter((line) => line.startsWith("| `page-"));
    expect(rows).toEqual([
      "| `page-home` | `/` | `trace-panel` |",
      "| `page-trade` | `/trade/:symbol` | `dag-scheduling`, `layout-hints` |",
      "| `page-vaults` | `/vaults` | _(no demonstrated capabilities declared)_ |",
    ]);
  });

  it("is deterministic regardless of input order", () => {
    const reversed = [...entries].reverse();
    expect(renderDemosBlock(reversed)).toBe(renderDemosBlock(entries));
  });

  it("does not mutate the caller's array", () => {
    const input = [...entries];
    renderDemosBlock(input);
    expect(input).toEqual(entries);
  });
});

describe("extractDemosBlock / replaceDemosBlock", () => {
  it("round-trips: replace then extract yields the new block", () => {
    const oldBlock = renderDemosBlock(entries);
    const newBlock = renderDemosBlock([
      ...entries,
      { page: "page-markets", route: "/markets", demonstrates: ["x"] },
    ]);
    const doc = docWithBlock(oldBlock);
    const updated = replaceDemosBlock(doc, newBlock);
    expect(extractDemosBlock(updated)).toBe(newBlock);
    // hand-written prose outside the markers is untouched
    expect(updated.startsWith("# DEMOS\n\nintro prose\n\n")).toBe(true);
    expect(updated.endsWith("\n\ntrailing prose\n")).toBe(true);
  });

  it("returns null when markers are absent", () => {
    expect(extractDemosBlock("# DEMOS\nno markers here\n")).toBeNull();
  });

  it("returns null when markers are out of order", () => {
    const doc = `${DEMOS_BLOCK_END}\nmiddle\n${DEMOS_BLOCK_BEGIN}`;
    expect(extractDemosBlock(doc)).toBeNull();
  });

  it("replaceDemosBlock throws MissingDemosMarkersError without markers", () => {
    expect(() => replaceDemosBlock("no markers", "block")).toThrow(
      MissingDemosMarkersError,
    );
  });
});

describe("checkDemosBlockFreshness", () => {
  it("is fresh when the document block matches the expected block", () => {
    const block = renderDemosBlock(entries);
    expect(checkDemosBlockFreshness(block, docWithBlock(block))).toEqual({
      status: "fresh",
    });
  });

  it("is stale when a manifest changed since the block was generated", () => {
    const block = renderDemosBlock(entries);
    const drifted = renderDemosBlock([
      { ...entries[0], demonstrates: ["dag-scheduling"] },
      ...entries.slice(1),
    ]);
    const result = checkDemosBlockFreshness(block, docWithBlock(drifted));
    expect(result.status).toBe("stale");
  });

  it("is stale when the document has no markers at all", () => {
    const block = renderDemosBlock(entries);
    const result = checkDemosBlockFreshness(block, "# DEMOS\nno markers\n");
    expect(result).toEqual({ status: "stale", expected: block, actual: null });
  });
});
