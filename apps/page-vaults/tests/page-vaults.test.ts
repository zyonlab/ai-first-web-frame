import { PageManifestSchema } from "@mvp/contracts";
import { describe, expect, it } from "vitest";
import { GET as healthGet } from "../app/health/route";
import { vaultsPageBudget } from "../src/budget";
import { vaultsPageManifest } from "../src/manifest";
import { metadata, vaultsSeoCopy } from "../src/metadata";
import { renderVaultsHtml, vaultCards } from "../src/render";

describe("page-vaults", () => {
  it("SSR HTML is no-JS readable and carries the page marker + SEO copy", () => {
    const html = renderVaultsHtml();
    expect(html).toContain('data-page="vaults"');
    expect(html).toContain(vaultsSeoCopy.title);
    expect(html).toContain(vaultsSeoCopy.description);
  });

  it("renders a heading and one card per vault", () => {
    const html = renderVaultsHtml();
    expect(html).toContain("<h1>");
    expect(html).toContain('data-area="vaults-grid"');
    for (const vault of vaultCards) {
      expect(html).toContain(`data-vault="${vault.slug}"`);
      expect(html).toContain(vault.name);
      expect(html).toContain(vault.apy);
      expect(html).toContain(vault.tvl);
    }
  });

  it("card markup carries APY and TVL stat regions (no-JS readable)", () => {
    const html = renderVaultsHtml();
    expect(html).toContain('data-stat="apy"');
    expect(html).toContain('data-stat="tvl"');
    expect(html).toContain("<dt>APY</dt>");
    expect(html).toContain("<dt>TVL</dt>");
  });

  it("metadata includes title and description", () => {
    expect(metadata).toMatchObject({
      title: vaultsSeoCopy.title,
      description: vaultsSeoCopy.description,
    });
  });

  it("declares a static page budget: 0 client JS, within 50KB CSS", () => {
    expect(vaultsPageBudget.scope).toBe("page");
    expect(vaultsPageBudget.jsBytes).toBe(0);
    expect(vaultsPageBudget.cssBytes).toBeLessThanOrEqual(50000);
  });

  it("health route returns page-vaults ok", async () => {
    const res = await healthGet();
    await expect(res.json()).resolves.toEqual({
      status: "ok",
      service: "page-vaults",
    });
  });

  it("page manifest passes PageManifestSchema (slotless unit-graph entry)", () => {
    const parsed = PageManifestSchema.parse(vaultsPageManifest);
    expect(parsed.route).toBe("/vaults");
    expect(parsed.slots).toEqual([]);
    expect(vaultsPageManifest.revalidateSeconds).toBe(3600);
  });
});
