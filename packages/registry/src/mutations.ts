import {
  type FragmentRegistry,
  FragmentRegistrySchema,
  type ReleaseChannel,
  ReleaseChannelSchema,
  type ReleaseManifest,
  ReleaseManifestSchema,
} from "@mvp/contracts";
import { loadFileWithHash, writeFileAtomic } from "./atomic-file";

export type FragmentRegistryData = FragmentRegistry;

export type ReleaseRecord = ReleaseManifest & { releasedAt?: string };

export type ReleasesFile = { releases: ReleaseRecord[] };

export type MutationAction = "added" | "updated" | "unchanged";

export type RegisterFragmentInput = {
  name: string;
  version: string;
  serviceUrl: string;
  manifestUrl?: string;
  /** Optional runtime island asset URL (C3 spike, §4.3.3). */
  assetsUrl?: string;
  channel?: ReleaseChannel;
};

export type RegistryMutation = {
  registry: FragmentRegistryData;
  changed: boolean;
  action: MutationAction;
};

export type ReleaseMutation = {
  registry: FragmentRegistryData;
  changed: boolean;
  release: ReleaseRecord | null;
};

const FRAGMENT_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function applyRegisterFragment(
  data: FragmentRegistryData,
  input: RegisterFragmentInput,
): RegistryMutation {
  const channel = input.channel ?? "canary";
  if (!FRAGMENT_NAME_PATTERN.test(input.name))
    throw new Error(
      `fragment name "${input.name}" must be kebab-case (e.g. "price-panel")`,
    );
  if (!input.version) throw new Error('version is required (e.g. "0.1.0")');
  if (!/^https?:\/\//.test(input.serviceUrl))
    throw new Error(`serviceUrl "${input.serviceUrl}" must be an http(s) URL`);
  if (!ReleaseChannelSchema.safeParse(channel).success)
    throw new Error(
      `channel "${channel}" must be one of stable | canary | preview`,
    );

  const entryVersion = {
    version: input.version,
    serviceUrl: input.serviceUrl,
    manifestUrl: input.manifestUrl ?? `${input.serviceUrl}/manifest`,
    ...(input.assetsUrl ? { assetsUrl: input.assetsUrl } : {}),
  };
  const next = structuredClone(data);
  const entry = next.fragments[input.name] ?? {};
  const previous = entry[channel];
  const action: MutationAction = !next.fragments[input.name]
    ? "added"
    : deepEqual(previous, entryVersion) &&
        deepEqual(entry.versions?.[input.version], entryVersion)
      ? "unchanged"
      : "updated";

  entry[channel] = entryVersion;
  entry.versions = { ...entry.versions, [input.version]: entryVersion };
  next.fragments[input.name] = entry;

  return {
    registry: FragmentRegistrySchema.parse(next),
    changed: action !== "unchanged",
    action,
  };
}

export function applyPromoteFragment(
  data: FragmentRegistryData,
  name: string,
  now: Date = new Date(),
): ReleaseMutation {
  const entry = data.fragments[name];
  if (!entry) throw new Error(`fragment "${name}" is not registered`);
  const canary = entry.canary;
  if (!canary)
    throw new Error(
      `fragment "${name}" has no canary channel to promote; register a canary first`,
    );
  const previousStable = entry.stable;
  if (previousStable && previousStable.version === canary.version)
    return { registry: data, changed: false, release: null };

  const next = structuredClone(data);
  const nextEntry = next.fragments[name];
  nextEntry.versions = {
    ...nextEntry.versions,
    ...(previousStable ? { [previousStable.version]: previousStable } : {}),
    [canary.version]: canary,
  };
  nextEntry.stable = canary;
  delete nextEntry.canary;

  const release: ReleaseRecord = {
    ...ReleaseManifestSchema.parse({
      unit: "fragment",
      name,
      version: canary.version,
      channel: "stable",
      ...(previousStable ? { rollbackTo: previousStable.version } : {}),
      smokeTests: [],
    }),
    releasedAt: now.toISOString(),
  };

  return {
    registry: FragmentRegistrySchema.parse(next),
    changed: true,
    release,
  };
}

export function applyRollbackFragment(
  data: FragmentRegistryData,
  releases: ReleaseRecord[],
  name: string,
  toVersion?: string,
  now: Date = new Date(),
): ReleaseMutation {
  const entry = data.fragments[name];
  if (!entry) throw new Error(`fragment "${name}" is not registered`);
  const currentStable = entry.stable;
  if (!currentStable)
    throw new Error(`fragment "${name}" has no stable channel to roll back`);

  const target =
    toVersion ??
    latestStableRelease(releases, name, currentStable.version)?.rollbackTo;
  if (!target)
    throw new Error(
      `fragment "${name}" has no recorded rollback target; pass --to <version>`,
    );
  if (target === currentStable.version)
    return { registry: data, changed: false, release: null };

  const targetEntry = entry.versions?.[target];
  if (!targetEntry)
    throw new Error(
      `fragment "${name}" has no pinned version "${target}" in its versions history`,
    );

  const next = structuredClone(data);
  const nextEntry = next.fragments[name];
  nextEntry.versions = {
    ...nextEntry.versions,
    [currentStable.version]: currentStable,
  };
  nextEntry.stable = targetEntry;

  const chainedRollbackTo = latestStableRelease(
    releases,
    name,
    target,
  )?.rollbackTo;
  const release: ReleaseRecord = {
    ...ReleaseManifestSchema.parse({
      unit: "fragment",
      name,
      version: target,
      channel: "stable",
      ...(chainedRollbackTo ? { rollbackTo: chainedRollbackTo } : {}),
      smokeTests: [],
    }),
    releasedAt: now.toISOString(),
  };

  return {
    registry: FragmentRegistrySchema.parse(next),
    changed: true,
    release,
  };
}

function latestStableRelease(
  releases: ReleaseRecord[],
  name: string,
  version: string,
): ReleaseRecord | undefined {
  return [...releases]
    .reverse()
    .find(
      (release) =>
        release.unit === "fragment" &&
        release.name === name &&
        release.channel === "stable" &&
        release.version === version,
    );
}

/**
 * Loaders return the content hash captured at read time; savers require it so
 * a concurrent writer surfaces as a FileConflictError instead of a lost update.
 */
export type LoadedRegistry = { data: FragmentRegistryData; hash: string };

export type LoadedReleases = { data: ReleasesFile; hash: string };

export function loadRegistryData(path: string): LoadedRegistry {
  const loaded = loadFileWithHash(path);
  if (loaded.content === null)
    throw new Error(`registry file not found: ${path}`);
  return {
    data: FragmentRegistrySchema.parse(JSON.parse(loaded.content)),
    hash: loaded.hash,
  };
}

export function saveRegistryData(
  path: string,
  data: FragmentRegistryData,
  expectedHash: string,
): void {
  writeFileAtomic(path, `${JSON.stringify(data, null, 2)}\n`, {
    expectedHash,
  });
}

export function loadReleases(path: string): LoadedReleases {
  const loaded = loadFileWithHash(path);
  if (loaded.content === null)
    return { data: { releases: [] }, hash: loaded.hash };
  const parsed = JSON.parse(loaded.content) as ReleasesFile;
  for (const release of parsed.releases) ReleaseManifestSchema.parse(release);
  return { data: parsed, hash: loaded.hash };
}

export function saveReleases(
  path: string,
  file: ReleasesFile,
  expectedHash: string,
): void {
  writeFileAtomic(path, `${JSON.stringify(file, null, 2)}\n`, {
    expectedHash,
  });
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
