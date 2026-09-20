import { describe, expect, it } from "vitest";
import {
  renderInline,
  renderMarkdown,
  renderSidebar,
} from "../../scripts/serve-docs.mts";

/**
 * The docs viewer renders a deliberate SUBSET of Markdown — the constructs
 * `website/docs/` actually uses. These tests pin that subset, and in particular
 * the three places a naive renderer gets it wrong in a way that would matter
 * here: HTML inside prose, `**bold**` versus `*emphasis*`, and code spans that
 * contain Markdown punctuation.
 */

describe("renderInline", () => {
  it("escapes HTML so documented markup renders as text", () => {
    expect(renderInline("a <div> tag")).toBe("a &lt;div&gt; tag");
  });

  it("keeps code spans literal, including Markdown punctuation inside them", () => {
    // `**a**` inside backticks must survive as asterisks, not become <strong>
    expect(renderInline("use `**a**` here")).toBe(
      "use <code>**a**</code> here",
    );
  });

  it("escapes angle brackets inside a code span", () => {
    expect(renderInline("`book.l2.<symbol>`")).toBe(
      "<code>book.l2.&lt;symbol&gt;</code>",
    );
  });

  it("renders bold before emphasis so ** is not read as two * markers", () => {
    expect(renderInline("**bold** and *em*")).toBe(
      "<strong>bold</strong> and <em>em</em>",
    );
  });

  it("renders strikethrough and links", () => {
    expect(renderInline("~~gone~~")).toBe("<del>gone</del>");
    expect(renderInline("[a](../b.md#f1)")).toBe('<a href="../b.md#f1">a</a>');
  });
});

describe("renderMarkdown", () => {
  it("gives every heading a slug id so in-page links resolve", () => {
    expect(renderMarkdown("## Slot scheduling")).toBe(
      '<h2 id="slot-scheduling">Slot scheduling</h2>',
    );
  });

  it("passes through the explicit anchors known-limitations.md relies on", () => {
    expect(renderMarkdown('<a id="f14"></a>')).toBe('<a id="f14"></a>');
  });

  it("never interprets Markdown inside a fenced block", () => {
    const html = renderMarkdown("```html\n<div hidden>**x**</div>\n```");
    expect(html).toContain("&lt;div hidden&gt;**x**&lt;/div&gt;");
    expect(html).not.toContain("<strong>");
  });

  it("renders a GFM pipe table with header cells", () => {
    const html = renderMarkdown("| A | B |\n| --- | --- |\n| 1 | `2` |");
    expect(html).toContain("<th>A</th>");
    expect(html).toContain("<td><code>2</code></td>");
  });

  it("does not treat a lone pipe line as a table", () => {
    expect(renderMarkdown("| not a table")).toBe("<p>| not a table</p>");
  });

  it("joins a bullet's wrapped continuation lines into one item", () => {
    const html = renderMarkdown("- first line\n  wrapped here\n- second");
    expect(html).toContain("<li>first line wrapped here</li>");
    expect(html).toContain("<li>second</li>");
  });

  it("closes every list it opens", () => {
    const html = renderMarkdown("- a\n- b\n\nAfter.");
    expect((html.match(/<ul>/g) ?? []).length).toBe(
      (html.match(/<\/ul>/g) ?? []).length,
    );
    expect(html).toContain("<p>After.</p>");
  });

  it("renders ordered lists as <ol>", () => {
    expect(renderMarkdown("1. one\n2. two")).toContain("<ol>");
  });

  it("renders blockquotes and rules", () => {
    expect(renderMarkdown("> note")).toBe("<blockquote>note</blockquote>");
    expect(renderMarkdown("---")).toBe("<hr />");
  });
});

describe("renderSidebar", () => {
  const nav = [
    { text: "Guides", dir: "guides", items: ["ai-setup", "slot-scheduling"] },
    { text: "Known limitations", file: "known-limitations" },
  ];

  it("uppercases acronyms a naive capitalisation would mangle", () => {
    expect(renderSidebar(nav, "")).toContain(">AI setup<");
    expect(renderSidebar(nav, "")).not.toContain(">Ai setup<");
  });

  it("marks the current page active", () => {
    const html = renderSidebar(nav, "guides/slot-scheduling.md");
    expect(html).toContain(
      '<a class="active" href="/guides/slot-scheduling.md">',
    );
  });

  it("links a standalone section file", () => {
    expect(renderSidebar(nav, "")).toContain('href="/known-limitations.md"');
  });
});
