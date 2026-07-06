import { describe, expect, it } from "vitest";
import {
  type Asset,
  collectAssets,
  createAssetHtmlTags,
  createAssetKey,
  mergeAssetsWithPolicy,
} from "./index";

describe("@mvp/assets", () => {
  it("collects manifest buckets, de-duplicates resources, and sorts deterministically", () => {
    const assets = collectAssets(
      {
        css: [
          {
            href: "/assets/base.css",
            integrity: "sha384-css",
            order: 10,
          },
        ],
        js: [
          {
            src: "/assets/app.js",
            integrity: "sha384-js",
            order: 30,
          },
        ],
        fonts: [{ href: "/assets/inter.woff2", format: "woff2", order: 20 }],
        themes: [{ name: "brand", href: "/assets/brand.css", order: 15 }],
        i18n: [
          {
            locale: "en-US",
            namespace: "common",
            href: "/assets/en/common.json",
            order: 40,
          },
        ],
      },
      [
        {
          type: "css",
          href: "/assets/base.css",
          nonce: "nonce-css",
          order: 10,
        },
        { type: "js", src: "/assets/app.js", nonce: "nonce-js", order: 30 },
        { type: "font", href: "/assets/inter.woff2", preload: true, order: 20 },
        { type: "theme", name: "brand", content: ":root{}", order: 15 },
        {
          type: "i18n",
          locale: "en-US",
          namespace: "common",
          messages: { ok: "OK" },
          order: 40,
        },
      ],
    );

    expect(assets.map((asset) => asset.type)).toEqual([
      "css",
      "theme",
      "font",
      "js",
      "i18n",
    ]);
    expect(assets).toHaveLength(5);
    expect(assets[0]).toMatchObject({
      type: "css",
      href: "/assets/base.css",
      integrity: "sha384-css",
      nonce: "nonce-css",
    });
    expect(assets[3]).toMatchObject({
      type: "js",
      src: "/assets/app.js",
      integrity: "sha384-js",
      nonce: "nonce-js",
    });
  });

  it("de-duplicates css, js, font, theme, and i18n assets by type-specific keys", () => {
    const input: Asset[] = [
      { type: "css", href: "/dup.css" },
      { type: "css", href: "/dup.css" },
      { type: "js", src: "/dup.js" },
      { type: "js", src: "/dup.js" },
      { type: "font", href: "/dup.woff2" },
      { type: "font", href: "/dup.woff2" },
      { type: "theme", name: "brand", href: "/brand.css" },
      { type: "theme", name: "brand", href: "/brand-v2.css" },
      { type: "i18n", locale: "en-US", namespace: "common", href: "/one.json" },
      { type: "i18n", locale: "en-US", namespace: "common", href: "/two.json" },
    ];

    expect(mergeAssetsWithPolicy(input)).toHaveLength(5);
  });

  it("preserves CSP nonce and SRI fields when keeping the last duplicate", () => {
    const assets = mergeAssetsWithPolicy(
      [
        {
          type: "js",
          src: "/assets/app.js",
          integrity: "sha384-first",
          nonce: "nonce-first",
        },
        {
          type: "js",
          src: "/assets/app.js",
          defer: true,
        },
      ],
      { duplicate: "keep-last" },
    );

    expect(assets).toEqual([
      {
        type: "js",
        src: "/assets/app.js",
        defer: true,
        integrity: "sha384-first",
        nonce: "nonce-first",
      },
    ]);
  });

  it("supports custom duplicate policy and type ordering", () => {
    expect(() =>
      mergeAssetsWithPolicy(
        [
          { type: "css", href: "/one.css" },
          { type: "css", href: "/one.css" },
        ],
        { duplicate: "error" },
      ),
    ).toThrow("Duplicate asset key");

    const assets = mergeAssetsWithPolicy(
      [
        { type: "css", href: "/one.css" },
        { type: "js", src: "/one.js" },
        { type: "theme", name: "brand" },
      ],
      { typeOrder: ["js", "theme", "css"] },
    );

    expect(assets.map((asset) => asset.type)).toEqual(["js", "theme", "css"]);
  });

  it("uses ids as explicit de-duplication keys", () => {
    const assets = mergeAssetsWithPolicy([
      { type: "css", id: "shell", href: "/one.css" },
      { type: "css", id: "shell", href: "/two.css" },
    ]);

    expect(assets.map(createAssetKey)).toEqual(["css\u0000id\u0000shell"]);
    expect(assets[0]).toMatchObject({ href: "/one.css" });
  });

  it("creates html tag descriptors for governed runtime injection", () => {
    const tags = createAssetHtmlTags([
      {
        type: "theme",
        name: "default",
        content: ":root{--mvp-color:#111}",
        nonce: "nonce-theme",
      },
      {
        type: "i18n",
        locale: "en-US",
        namespace: "common",
        messages: { hello: "Hello" },
      },
      {
        type: "font",
        href: "data:font/woff2;base64,d09GMgAB",
        format: "woff2",
        preload: true,
      },
      {
        type: "js",
        src: "/asset.js",
        module: true,
        integrity: "sha384-js",
      },
    ]);

    expect(tags).toEqual([
      {
        tag: "style",
        attributes: { "data-theme": "default", nonce: "nonce-theme" },
        content: ":root{--mvp-color:#111}",
      },
      {
        tag: "script",
        attributes: {
          type: "application/json",
          id: "i18n-en-US-common",
          "data-locale": "en-US",
          "data-namespace": "common",
        },
        content: '{"hello":"Hello"}',
      },
      {
        tag: "link",
        attributes: {
          rel: "preload",
          href: "data:font/woff2;base64,d09GMgAB",
          as: "font",
          type: "font/woff2",
          crossOrigin: "anonymous",
        },
      },
      {
        tag: "script",
        attributes: {
          src: "/asset.js",
          type: "module",
          integrity: "sha384-js",
        },
      },
    ]);
  });
});
