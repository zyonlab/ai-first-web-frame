import { PageManifestSchema } from "@mvp/contracts";
import { describe, expect, it } from "vitest";
import { GET as healthGet } from "../app/health/route";
import { referralsPageBudget } from "../src/budget";
import { referralsPageManifest } from "../src/manifest";
import { metadata, referralsSeoCopy } from "../src/metadata";
import {
  REFERRAL_CODE,
  referralNotes,
  referralTiers,
  renderReferralsHtml,
} from "../src/render";

describe("page-referrals", () => {
  it("SSR HTML is no-JS readable and carries the page marker + SEO copy", () => {
    const html = renderReferralsHtml();
    expect(html).toContain('data-page="referrals"');
    expect(html).toContain(referralsSeoCopy.title);
    expect(html).toContain(referralsSeoCopy.description);
  });

  it("renders the mock referral code", () => {
    const html = renderReferralsHtml();
    expect(html).toContain("data-referral-code");
    expect(html).toContain(REFERRAL_CODE);
  });

  it("renders the rebate-tier table with one row per tier", () => {
    const html = renderReferralsHtml();
    expect(html).toContain('data-area="referral-tiers"');
    expect(html).toContain("<table>");
    for (const tier of referralTiers) {
      expect(html).toContain(`data-tier="${tier.tier.toLowerCase()}"`);
      expect(html).toContain(tier.tier);
      expect(html).toContain(tier.rebate);
    }
  });

  it("renders program notes (no-JS readable)", () => {
    const html = renderReferralsHtml();
    expect(html).toContain('data-area="referral-notes"');
    for (const note of referralNotes) {
      expect(html).toContain(note);
    }
  });

  it("metadata includes title and description", () => {
    expect(metadata).toMatchObject({
      title: referralsSeoCopy.title,
      description: referralsSeoCopy.description,
    });
  });

  it("declares a static page budget: 0 client JS, within 50KB CSS", () => {
    expect(referralsPageBudget.scope).toBe("page");
    expect(referralsPageBudget.jsBytes).toBe(0);
    expect(referralsPageBudget.cssBytes).toBeLessThanOrEqual(50000);
  });

  it("health route returns page-referrals ok", async () => {
    const res = await healthGet();
    await expect(res.json()).resolves.toEqual({
      status: "ok",
      service: "page-referrals",
    });
  });

  it("page manifest passes PageManifestSchema (slotless unit-graph entry)", () => {
    const parsed = PageManifestSchema.parse(referralsPageManifest);
    expect(parsed.route).toBe("/referrals");
    expect(parsed.slots).toEqual([]);
    expect(referralsPageManifest.renderMode).toBe("ssg");
  });
});
