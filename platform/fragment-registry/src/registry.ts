export type ReleaseChannel = "stable" | "canary" | "preview";

export type FragmentVersion = {
  version: string;
  serviceUrl: string;
  manifestUrl: string;
};

export type FragmentRegistry = {
  fragments: Record<string, Partial<Record<ReleaseChannel, FragmentVersion>>>;
};

export const fragmentRegistry: FragmentRegistry = {
  fragments: {
    "promotion-banner": {
      stable: {
        version: "0.1.0",
        serviceUrl: process.env.PROMOTION_BANNER_URL ?? "http://localhost:4201",
        manifestUrl: `${process.env.PROMOTION_BANNER_URL ?? "http://localhost:4201"}/manifest`,
      },
      canary: {
        version: "0.2.0-beta.1",
        serviceUrl: process.env.PROMOTION_BANNER_URL ?? "http://localhost:4201",
        manifestUrl: `${process.env.PROMOTION_BANNER_URL ?? "http://localhost:4201"}/manifest`,
      },
    },
    "recommendation-widget": {
      stable: {
        version: "0.1.0",
        serviceUrl:
          process.env.RECOMMENDATION_WIDGET_URL ?? "http://localhost:4202",
        manifestUrl: `${process.env.RECOMMENDATION_WIDGET_URL ?? "http://localhost:4202"}/manifest`,
      },
    },
  },
};

export function resolveFragment(
  name: string,
  versionOrChannel: ReleaseChannel | string = "stable",
  registry: FragmentRegistry = fragmentRegistry,
): FragmentVersion | null {
  const entry = registry.fragments[name];
  if (!entry) return null;

  if (isReleaseChannel(versionOrChannel))
    return entry[versionOrChannel] ?? null;

  return (
    Object.values(entry).find(
      (candidate) => candidate?.version === versionOrChannel,
    ) ?? null
  );
}

export function validateFragmentRegistry(registry: FragmentRegistry): boolean {
  return Object.entries(registry.fragments).every(
    ([name, channels]) =>
      name.length > 0 &&
      Object.entries(channels).every(
        ([channel, value]) =>
          isReleaseChannel(channel) &&
          typeof value?.version === "string" &&
          value.serviceUrl.startsWith("http") &&
          value.manifestUrl.startsWith("http"),
      ),
  );
}

function isReleaseChannel(value: string): value is ReleaseChannel {
  return value === "stable" || value === "canary" || value === "preview";
}
