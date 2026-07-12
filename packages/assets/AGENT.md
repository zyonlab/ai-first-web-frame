# @mvp/assets — AGENT.md

## What this package is for

`@mvp/assets` is the framework's typed asset-manifest model: a discriminated
`Asset` union (`css | js | font | theme | i18n`) plus pure functions to
collect assets from nested sources (single assets, arrays, `AssetManifest`
buckets), de-duplicate them under a configurable policy while preserving
CSP/SRI security fields, sort them deterministically, and render them to
framework-agnostic HTML tag descriptors for governed runtime injection. It
has zero dependencies and touches no globals — safe on server and client.
Inputs are never mutated (assets are cloned on the way in and out).

## Entry points

- `collectAssets(...sources: readonly AssetSource[]): Asset[]` — flattens any
  mix of `Asset`, nested arrays, and `AssetManifest` objects
  (`{ assets?, css?, js?, font?/fonts?, theme?/themes?, i18n? }`; bucket
  entries may omit `type`, it is inferred from the bucket), then merges with
  the default policy (`keep-first`) and sorts. The one-call entry point.
- `mergeAssetsWithPolicy(assets: readonly Asset[], policy?: MergeAssetsPolicy): Asset[]`
  — de-duplication + ordering only. `policy.duplicate`:
  `"keep-first"` (default) | `"keep-last"` | `"error"`; either keep-policy
  back-fills missing security fields (`nonce`, `integrity`, `crossOrigin`,
  `referrerPolicy`, `fetchPriority`) from the discarded duplicate.
  `policy.getKey` overrides the identity function; `policy.typeOrder` ranks
  the listed types first (unlisted types keep the default order after them).
  Sort is deterministic: `order` (default 0), then type rank (default
  `css < theme < font < js < i18n`), then key, then input index.
- `createAssetKey(asset: Asset): string` — the default identity: an explicit
  `id` wins (`<type>\u0000id\u0000<id>`); otherwise css keys on
  `href`+`media`+`layer`, js on `src`, font on `href`, theme on `name`, i18n
  on `locale`+`namespace` (parts joined with `"\u0000"`).
- `createAssetHtmlTags(assets: readonly Asset[]): AssetHtmlTag[]` — maps each
  asset to `{ tag: "link" | "script" | "style", attributes, content? }`:
  css → `<link rel="stylesheet">`; js → `<script>` (`type="module"`,
  `async`, `defer` when set); font → a `<link rel="preload" as="font">`
  **only when `preload: true`** (non-preload fonts emit no tag —
  they're expected to load via CSS); theme → `<link data-theme>` when `href`
  is set, else an inline `<style data-theme>` with `content` (neither → no
  tag); i18n → an `application/json` `<script id="i18n-<locale>-<namespace>">`
  whose content is the `messages` map (or `{ href }` when messages are
  remote). Security fields and free-form `attributes` are spread onto every
  tag; font preloads default `crossOrigin` to `"anonymous"`.
- Types: `Asset`/`CssAsset`/`JsAsset`/`FontAsset`/`ThemeAsset`/`I18nAsset`,
  `*AssetInput` (type-optional bucket forms), `AssetManifest`, `AssetSource`,
  `MergeAssetsPolicy`, `AssetHtmlTag`.

## Error taxonomy

- **Plain `Error`** (`"Duplicate asset key: <key>"`) — thrown only by
  `mergeAssetsWithPolicy`/`collectAssets` when `policy.duplicate === "error"`
  and two assets share a key. Nothing else throws; unknown manifest keys are
  simply ignored and empty inputs produce `[]`.

## Example

```ts
import {
  collectAssets,
  createAssetHtmlTags,
  createAssetKey,
  mergeAssetsWithPolicy,
  type Asset,
  type AssetManifest,
} from "@mvp/assets";

// A page manifest (bucket entries may omit `type`) + a fragment's assets.
const pageManifest: AssetManifest = {
  css: [{ href: "/assets/page.css" }],
  js: [{ src: "/assets/page.js", module: true }],
  fonts: [{ href: "/assets/inter.woff2", preload: true, format: "woff2" }],
};
const fragmentAssets: Asset[] = [
  // Duplicate of the page css, but carrying SRI — keep-first keeps the page's
  // asset and back-fills the integrity from this discarded duplicate.
  { type: "css", href: "/assets/page.css", integrity: "sha384-abc" },
];

const assets = collectAssets(pageManifest, fragmentAssets);
if (assets.length !== 3) throw new Error("duplicate css must collapse to one");
if (assets.map((a) => a.type).join() !== "css,font,js")
  throw new Error("deterministic type order: css < theme < font < js < i18n");
if (assets[0].type === "css" && assets[0].integrity !== "sha384-abc")
  throw new Error("security fields survive de-duplication");

// Identity: id wins; otherwise type-specific fields, joined with "\u0000".
const key = createAssetKey({ type: "i18n", locale: "en", namespace: "nav" });
if (key !== ["i18n", "en", "nav"].join("\u0000")) throw new Error("i18n key");

// duplicate: "error" is the strict mode.
let threw = false;
try {
  mergeAssetsWithPolicy(
    [
      { type: "js", src: "/a.js" },
      { type: "js", src: "/a.js" },
    ],
    { duplicate: "error" },
  );
} catch (error) {
  threw = error instanceof Error && error.message.startsWith("Duplicate asset key:");
}
if (!threw) throw new Error("duplicate policy 'error' must throw");

// HTML tag descriptors for governed injection (no DOM access in here).
const tags = createAssetHtmlTags(assets);
if (tags[0].tag !== "link" || tags[0].attributes.rel !== "stylesheet")
  throw new Error("css -> stylesheet link");
if (tags[0].attributes.integrity !== "sha384-abc") throw new Error("SRI on tag");
const font = tags.find((t) => t.attributes.as === "font");
if (font?.attributes.crossOrigin !== "anonymous")
  throw new Error("font preload defaults crossOrigin=anonymous");
const script = tags.find((t) => t.tag === "script");
if (script?.attributes.type !== "module") throw new Error("module script");
```

## Accept

```
pnpm --filter @mvp/assets test
```
Expected: Vitest exits 0. `packages/assets/src/index.test.ts` covers manifest
bucket collection + deterministic sorting, type-specific de-duplication keys,
nonce/SRI preservation across duplicate policies, custom `getKey`/`typeOrder`,
explicit-`id` keys, and the HTML tag descriptors.
