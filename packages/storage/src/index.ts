import {
  type CookiePolicy,
  CookiePolicySchema,
  type DataPrivacy,
  type RequestContext,
  type StoragePolicy,
  StoragePolicySchema,
} from "@mvp/contracts";

export type StoragePartitionKey = StoragePolicy["partitionBy"][number];

export type StoragePartitionContext = Pick<
  RequestContext,
  "tenant" | "locale" | "theme" | "device"
> & {
  user?: RequestContext["user"];
};

export type StoragePolicyValidationResult =
  | { ok: true; policy: StoragePolicy; issues: [] }
  | { ok: false; issues: string[] };

const publicPartitionKeys = new Set<StoragePartitionKey>([
  "tenant",
  "locale",
  "theme",
  "device",
]);

export class StoragePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoragePolicyError";
  }
}

export function requiredPartitionKeysForPrivacy(
  privacy: DataPrivacy,
): StoragePartitionKey[] {
  if (privacy === "public") return [];
  if (privacy === "tenant") return ["tenant"];
  if (privacy === "user-segment") return ["tenant", "locale"];
  return ["tenant", "user"];
}

export function validateStoragePolicy(
  input: unknown,
): StoragePolicyValidationResult {
  const parsed = StoragePolicySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const required = requiredPartitionKeysForPrivacy(parsed.data.privacy);
  const missing = required.filter(
    (key) => !parsed.data.partitionBy.includes(key),
  );
  if (missing.length > 0) {
    return {
      ok: false,
      issues: [
        `storage policy "${parsed.data.id}" must partition ${parsed.data.privacy} data by ${missing.join(", ")}`,
      ],
    };
  }

  return { ok: true, policy: parsed.data, issues: [] };
}

export function assertStoragePolicy(input: unknown): StoragePolicy {
  const result = validateStoragePolicy(input);
  if (!result.ok) throw new StoragePolicyError(result.issues.join("; "));
  return result.policy;
}

export function resolveStoragePartition(
  policyInput: unknown,
  ctx: StoragePartitionContext,
): Record<StoragePartitionKey, string> {
  const policy = assertStoragePolicy(policyInput);
  const partition = {} as Record<StoragePartitionKey, string>;

  for (const key of policy.partitionBy) {
    const value = valueForPartitionKey(key, ctx);
    if (!value) {
      throw new StoragePolicyError(
        `storage policy "${policy.id}" requires ${key} partition value`,
      );
    }
    partition[key] = value;
  }

  return partition;
}

export function createStorageKey(
  policyInput: unknown,
  logicalKey: string,
  ctx: StoragePartitionContext,
): string {
  const policy = assertStoragePolicy(policyInput);
  const partition = resolveStoragePartition(policy, ctx);
  const segments = [
    "mvp",
    encodeStorageKeySegment(policy.id),
    policy.adapter,
    policy.privacy,
    ...policy.partitionBy.map(
      (key) => `${key}:${encodeStorageKeySegment(partition[key])}`,
    ),
    encodeStorageKeySegment(logicalKey),
  ];
  return segments.join("|");
}

export function createCookiePolicy(
  name: string,
  overrides: Partial<Omit<CookiePolicy, "name">> = {},
): CookiePolicy {
  return CookiePolicySchema.parse({ name, ...overrides });
}

export function createCookiePolicyForStorage(
  policyInput: unknown,
  name: string,
  overrides: Partial<Omit<CookiePolicy, "name">> = {},
): CookiePolicy {
  const policy = assertStoragePolicy(policyInput);
  if (policy.adapter !== "cookie") {
    throw new StoragePolicyError(
      `storage policy "${policy.id}" uses ${policy.adapter}, not cookie`,
    );
  }

  return createCookiePolicy(name, {
    ...overrides,
    maxAge: policy.ttl && policy.ttl > 0 ? policy.ttl : overrides.maxAge,
    encrypted: policy.encrypted || overrides.encrypted === true,
    signed:
      policy.privacy === "user-private" ||
      policy.privacy === "tenant" ||
      overrides.signed === true,
    httpOnly: policy.ssr ? true : overrides.httpOnly,
  });
}

export function canUseSharedStorage(policyInput: unknown): boolean {
  const policy = assertStoragePolicy(policyInput);
  return policy.privacy === "public" && policy.partitionBy.length === 0;
}

function valueForPartitionKey(
  key: StoragePartitionKey,
  ctx: StoragePartitionContext,
) {
  if (key === "user") return ctx.user?.id;
  if (publicPartitionKeys.has(key)) return String(ctx[key]);
  return undefined;
}

function encodeStorageKeySegment(value: string) {
  return encodeURIComponent(value.trim()).replaceAll("%20", "+");
}
