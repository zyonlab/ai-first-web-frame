import {
  FragmentRegistryEntrySchema,
  FragmentRegistrySchema,
  type ReleaseChannel,
} from "@mvp/contracts";
import registryData from "../../../registry/registry.data.json";

// Re-exported so registry consumers keep a single channel type source.
export type { ReleaseChannel } from "@mvp/contracts";

export type FragmentVersion = {
  version: string;
  serviceUrl: string;
  manifestUrl: string;
  /** Optional runtime island asset URL (C3 spike, §4.3.3). */
  assetsUrl?: string;
};

export type FragmentChannels = Partial<
  Record<ReleaseChannel, FragmentVersion>
> & {
  versions?: Record<string, FragmentVersion>;
};

export type FragmentRegistry = {
  fragments: Record<string, FragmentChannels>;
};

const RELEASE_CHANNELS = ["stable", "canary", "preview"] as const;

export function fragmentEnvVarName(name: string): string {
  return `${name.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase()}_URL`;
}

export function buildFragmentRegistry(
  data: unknown = registryData,
  env: Record<string, string | undefined> = process.env,
): FragmentRegistry {
  const parsed = FragmentRegistrySchema.parse(data);
  const fragments: FragmentRegistry["fragments"] = {};
  for (const [name, channels] of Object.entries(parsed.fragments)) {
    const envVar = fragmentEnvVarName(name);
    const override = validateEnvOverride(envVar, env[envVar]);
    const entry: FragmentChannels = {};
    for (const channel of RELEASE_CHANNELS) {
      const version = channels[channel];
      if (version) entry[channel] = withOverride(version, override);
    }
    if (channels.versions) {
      entry.versions = Object.fromEntries(
        Object.entries(channels.versions).map(([key, version]) => [
          key,
          withOverride(version, override),
        ]),
      );
    }
    fragments[name] = entry;
  }
  return { fragments };
}

/**
 * H3: a `<NAME>_URL` env override is spliced into serviceUrl/manifestUrl for
 * every resolved version, so garbage here used to propagate silently into
 * each fragment fetch. Validate it at build time (module load / boot) with
 * the same URL schema the registry entry itself uses
 * (`FragmentRegistryEntrySchema.serviceUrl`, i.e. `z.string().url()`).
 * An unset or empty value keeps the pre-existing "no override" behavior.
 */
function validateEnvOverride(
  envVar: string,
  value: string | undefined,
): string | undefined {
  if (!value) return value;
  const result = FragmentRegistryEntrySchema.shape.serviceUrl.safeParse(value);
  if (!result.success)
    throw new Error(
      `FragmentRegistryEntrySchema: env override ${envVar}="${value}" is not a valid serviceUrl (z.string().url()): ${
        result.error.issues[0]?.message ?? "invalid url"
      }`,
    );
  return value;
}

function withOverride(
  entry: FragmentVersion,
  override: string | undefined,
): FragmentVersion {
  if (!override) return { ...entry };
  return {
    version: entry.version,
    serviceUrl: override,
    manifestUrl: `${override}/manifest`,
    // Not rewritten relative to the overridden host — an env override points
    // serviceUrl/manifestUrl at a different host, but assetsUrl (when
    // present) still points at wherever it was registered. Known limitation,
    // documented in the C3 spike findings (§4.3.3): a real rollout needs
    // assetsUrl to derive from the same override, not just serviceUrl.
    ...(entry.assetsUrl ? { assetsUrl: entry.assetsUrl } : {}),
  };
}

export const fragmentRegistry: FragmentRegistry = buildFragmentRegistry();

export function resolveFragment(
  name: string,
  versionOrChannel: ReleaseChannel | string = "stable",
  registry: FragmentRegistry = fragmentRegistry,
): FragmentVersion | null {
  const entry = registry.fragments[name];
  if (!entry) return null;

  if (isReleaseChannel(versionOrChannel))
    return entry[versionOrChannel] ?? null;

  if (entry.versions?.[versionOrChannel])
    return entry.versions[versionOrChannel];

  return (
    RELEASE_CHANNELS.map((channel) => entry[channel]).find(
      (candidate) => candidate?.version === versionOrChannel,
    ) ?? null
  );
}

export function validateFragmentRegistry(registry: FragmentRegistry): boolean {
  return FragmentRegistrySchema.safeParse(registry).success;
}

function isReleaseChannel(value: string): value is ReleaseChannel {
  return RELEASE_CHANNELS.includes(value as ReleaseChannel);
}
