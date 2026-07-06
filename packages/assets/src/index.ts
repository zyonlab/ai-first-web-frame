export type AssetType = "css" | "js" | "font" | "theme" | "i18n";

export type AssetAttributeValue = string | number | boolean;

export interface BaseAsset {
  readonly type: AssetType;
  readonly id?: string;
  readonly order?: number;
  readonly nonce?: string;
  readonly integrity?: string;
  readonly crossOrigin?: "anonymous" | "use-credentials";
  readonly referrerPolicy?: string;
  readonly fetchPriority?: "high" | "low" | "auto";
  readonly attributes?: Readonly<Record<string, AssetAttributeValue>>;
}

export interface CssAsset extends BaseAsset {
  readonly type: "css";
  readonly href: string;
  readonly media?: string;
  readonly layer?: string;
}

export interface JsAsset extends BaseAsset {
  readonly type: "js";
  readonly src: string;
  readonly async?: boolean;
  readonly defer?: boolean;
  readonly module?: boolean;
  readonly placement?: "head" | "body";
}

export interface FontAsset extends BaseAsset {
  readonly type: "font";
  readonly href: string;
  readonly family?: string;
  readonly format?: string;
  readonly preload?: boolean;
  readonly style?: string;
  readonly weight?: string;
}

export interface ThemeAsset extends BaseAsset {
  readonly type: "theme";
  readonly name: string;
  readonly href?: string;
  readonly content?: string;
  readonly media?: string;
}

export interface I18nAsset extends BaseAsset {
  readonly type: "i18n";
  readonly locale: string;
  readonly namespace: string;
  readonly href?: string;
  readonly messages?: Readonly<Record<string, string>>;
}

export type Asset = CssAsset | JsAsset | FontAsset | ThemeAsset | I18nAsset;

type WithoutType<TAsset extends Asset> = Omit<TAsset, "type"> & {
  readonly type?: never;
};

export type CssAssetInput = CssAsset | WithoutType<CssAsset>;
export type JsAssetInput = JsAsset | WithoutType<JsAsset>;
export type FontAssetInput = FontAsset | WithoutType<FontAsset>;
export type ThemeAssetInput = ThemeAsset | WithoutType<ThemeAsset>;
export type I18nAssetInput = I18nAsset | WithoutType<I18nAsset>;

export interface AssetManifest {
  readonly assets?: readonly AssetSource[];
  readonly css?: readonly CssAssetInput[];
  readonly js?: readonly JsAssetInput[];
  readonly font?: readonly FontAssetInput[];
  readonly fonts?: readonly FontAssetInput[];
  readonly theme?: readonly ThemeAssetInput[];
  readonly themes?: readonly ThemeAssetInput[];
  readonly i18n?: readonly I18nAssetInput[];
}

export type AssetSource = Asset | readonly AssetSource[] | AssetManifest;

export interface MergeAssetsPolicy {
  readonly duplicate?: "keep-first" | "keep-last" | "error";
  readonly getKey?: (asset: Asset) => string;
  readonly typeOrder?: readonly AssetType[];
}

export interface AssetHtmlTag {
  readonly tag: "link" | "script" | "style";
  readonly attributes: Readonly<Record<string, string | boolean>>;
  readonly content?: string;
}

interface AssetEntry {
  asset: Asset;
  key: string;
  index: number;
}

const defaultTypeOrder: Record<AssetType, number> = {
  css: 0,
  theme: 1,
  font: 2,
  js: 3,
  i18n: 4,
};

const securityFields = [
  "nonce",
  "integrity",
  "crossOrigin",
  "referrerPolicy",
  "fetchPriority",
] as const satisfies readonly (keyof BaseAsset)[];

export function collectAssets(...sources: readonly AssetSource[]): Asset[] {
  return mergeAssetsWithPolicy(flattenAssetSources(sources));
}

export function mergeAssetsWithPolicy(
  assets: readonly Asset[],
  policy: MergeAssetsPolicy = {},
): Asset[] {
  const duplicate = policy.duplicate ?? "keep-first";
  const getKey = policy.getKey ?? createAssetKey;
  const byKey = new Map<string, AssetEntry>();

  assets.forEach((asset, index) => {
    const next = cloneAsset(asset);
    const key = getKey(next);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, { asset: next, key, index });
      return;
    }

    if (duplicate === "error") {
      throw new Error(`Duplicate asset key: ${key}`);
    }

    if (duplicate === "keep-last") {
      existing.asset = preserveSecurityFields(next, existing.asset);
      existing.index = index;
      return;
    }

    existing.asset = preserveSecurityFields(existing.asset, next);
  });

  return [...byKey.values()]
    .sort((left, right) => compareEntries(left, right, policy.typeOrder))
    .map((entry) => cloneAsset(entry.asset));
}

export function createAssetKey(asset: Asset): string {
  if (asset.id) {
    return keyFromParts(asset.type, "id", asset.id);
  }

  switch (asset.type) {
    case "css":
      return keyFromParts(asset.type, asset.href, asset.media, asset.layer);
    case "js":
      return keyFromParts(asset.type, asset.src);
    case "font":
      return keyFromParts(asset.type, asset.href);
    case "theme":
      return keyFromParts(asset.type, asset.name);
    case "i18n":
      return keyFromParts(asset.type, asset.locale, asset.namespace);
  }
}

export function createAssetHtmlTags(assets: readonly Asset[]): AssetHtmlTag[] {
  const tags: AssetHtmlTag[] = [];
  for (const asset of assets) {
    const securityAttributes = pickSecurityAttributes(asset);
    if (asset.type === "css") {
      tags.push({
        tag: "link",
        attributes: {
          rel: "stylesheet",
          href: asset.href,
          ...(asset.media ? { media: asset.media } : {}),
          ...securityAttributes,
          ...asset.attributes,
        },
      });
      continue;
    }
    if (asset.type === "js") {
      tags.push({
        tag: "script",
        attributes: {
          src: asset.src,
          ...(asset.module ? { type: "module" } : {}),
          ...(asset.async ? { async: true } : {}),
          ...(asset.defer ? { defer: true } : {}),
          ...securityAttributes,
          ...asset.attributes,
        },
      });
      continue;
    }
    if (asset.type === "font") {
      if (asset.preload) {
        tags.push({
          tag: "link",
          attributes: {
            rel: "preload",
            href: asset.href,
            as: "font",
            ...(asset.format ? { type: `font/${asset.format}` } : {}),
            crossOrigin: asset.crossOrigin ?? "anonymous",
            ...securityAttributes,
            ...asset.attributes,
          },
        });
      }
      continue;
    }
    if (asset.type === "theme") {
      if (asset.href) {
        tags.push({
          tag: "link",
          attributes: {
            rel: "stylesheet",
            href: asset.href,
            "data-theme": asset.name,
            ...(asset.media ? { media: asset.media } : {}),
            ...securityAttributes,
            ...asset.attributes,
          },
        });
        continue;
      }
      if (asset.content) {
        tags.push({
          tag: "style",
          attributes: {
            "data-theme": asset.name,
            ...securityAttributes,
            ...asset.attributes,
          },
          content: asset.content,
        });
      }
      continue;
    }
    tags.push({
      tag: "script",
      attributes: {
        type: "application/json",
        id: `i18n-${asset.locale}-${asset.namespace}`,
        "data-locale": asset.locale,
        "data-namespace": asset.namespace,
        ...securityAttributes,
        ...asset.attributes,
      },
      content: JSON.stringify(asset.messages ?? { href: asset.href }),
    });
  }
  return tags;
}

function flattenAssetSources(sources: readonly AssetSource[]): Asset[] {
  const flattened: Asset[] = [];
  for (const source of sources) {
    flattenAssetSource(source, flattened);
  }
  return flattened;
}

function flattenAssetSource(source: AssetSource, flattened: Asset[]): void {
  if (isAssetSourceList(source)) {
    for (const child of source) {
      flattenAssetSource(child, flattened);
    }
    return;
  }

  if (isAsset(source)) {
    flattened.push(cloneAsset(source));
    return;
  }

  if (source.assets) {
    flattenAssetSource(source.assets, flattened);
  }

  pushBucket(flattened, "css", source.css);
  pushBucket(flattened, "js", source.js);
  pushBucket(flattened, "font", source.font);
  pushBucket(flattened, "font", source.fonts);
  pushBucket(flattened, "theme", source.theme);
  pushBucket(flattened, "theme", source.themes);
  pushBucket(flattened, "i18n", source.i18n);
}

function pushBucket<TType extends AssetType>(
  flattened: Asset[],
  type: TType,
  bucket:
    | readonly (
        | Extract<Asset, { type: TType }>
        | WithoutType<Extract<Asset, { type: TType }>>
      )[]
    | undefined,
): void {
  if (!bucket) {
    return;
  }

  for (const asset of bucket) {
    flattened.push(normalizeBucketAsset(type, asset));
  }
}

function normalizeBucketAsset<TType extends AssetType>(
  type: TType,
  asset:
    | Extract<Asset, { type: TType }>
    | WithoutType<Extract<Asset, { type: TType }>>,
): Extract<Asset, { type: TType }> {
  if ("type" in asset) {
    return cloneAsset(asset as Extract<Asset, { type: TType }>);
  }

  return { type, ...asset } as Extract<Asset, { type: TType }>;
}

function isAsset(source: AssetSource): source is Asset {
  return "type" in source;
}

function isAssetSourceList(
  source: AssetSource,
): source is readonly AssetSource[] {
  return Array.isArray(source);
}

function cloneAsset<TAsset extends Asset>(asset: TAsset): TAsset {
  return {
    ...asset,
    attributes: asset.attributes ? { ...asset.attributes } : undefined,
  } as TAsset;
}

function preserveSecurityFields(primary: Asset, secondary: Asset): Asset {
  let merged = cloneAsset(primary);

  for (const field of securityFields) {
    if (merged[field] === undefined && secondary[field] !== undefined) {
      merged = { ...merged, [field]: secondary[field] } as Asset;
    }
  }

  return merged;
}

function pickSecurityAttributes(asset: Asset): Record<string, string> {
  const attributes: Record<string, string> = {};
  if (asset.nonce) attributes.nonce = asset.nonce;
  if (asset.integrity) attributes.integrity = asset.integrity;
  if (asset.crossOrigin) attributes.crossOrigin = asset.crossOrigin;
  if (asset.referrerPolicy) attributes.referrerPolicy = asset.referrerPolicy;
  if (asset.fetchPriority) attributes.fetchPriority = asset.fetchPriority;
  return attributes;
}

function compareEntries(
  left: AssetEntry,
  right: AssetEntry,
  typeOrder: readonly AssetType[] | undefined,
): number {
  const orderDelta = (left.asset.order ?? 0) - (right.asset.order ?? 0);
  if (orderDelta !== 0) {
    return orderDelta;
  }

  const typeDelta =
    getTypeRank(left.asset.type, typeOrder) -
    getTypeRank(right.asset.type, typeOrder);
  if (typeDelta !== 0) {
    return typeDelta;
  }

  const keyDelta = left.key.localeCompare(right.key);
  if (keyDelta !== 0) {
    return keyDelta;
  }

  return left.index - right.index;
}

function getTypeRank(
  type: AssetType,
  typeOrder: readonly AssetType[] | undefined,
): number {
  const customRank = typeOrder?.indexOf(type) ?? -1;
  if (customRank >= 0) {
    return customRank;
  }
  return (typeOrder?.length ?? 0) + defaultTypeOrder[type];
}

function keyFromParts(...parts: readonly (string | undefined)[]): string {
  return parts.map((part) => part ?? "").join("\u0000");
}
