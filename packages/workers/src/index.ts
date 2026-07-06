import {
  type DataPrivacy,
  type WorkerManifest,
  WorkerManifestSchema,
} from "@mvp/contracts";

export type WorkerManifestValidationResult =
  | { ok: true; manifest: WorkerManifest; issues: [] }
  | { ok: false; issues: string[] };

export type WorkerTaskDescription<TPayload = unknown> = {
  id: string;
  workerId: string;
  kind: WorkerManifest["kind"];
  name: string;
  privacy: DataPrivacy;
  cancellable: boolean;
  payload: TPayload;
  traceId?: string;
  cacheKey?: string;
};

export type DescribeWorkerTaskOptions<TPayload = unknown> = {
  id?: string;
  name: string;
  payload: TPayload;
  traceId?: string;
  cancellable?: boolean;
  cacheKey?: string;
  userPartitionKey?: string;
};

export class WorkerManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerManifestError";
  }
}

export function validateWorkerManifest(
  input: unknown,
): WorkerManifestValidationResult {
  const parsed = WorkerManifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const issues = policyIssuesForWorkerManifest(parsed.data);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, manifest: parsed.data, issues: [] };
}

export function assertWorkerManifest(input: unknown): WorkerManifest {
  const result = validateWorkerManifest(input);
  if (!result.ok) throw new WorkerManifestError(result.issues.join("; "));
  return result.manifest;
}

export function describeWorkerTask<TPayload>(
  manifestInput: unknown,
  options: DescribeWorkerTaskOptions<TPayload>,
): WorkerTaskDescription<TPayload> {
  const manifest = assertWorkerManifest(manifestInput);
  if (
    manifest.kind === "service-worker" &&
    manifest.privacy === "user-private" &&
    manifest.cachePolicy &&
    !options.userPartitionKey
  ) {
    throw new WorkerManifestError(
      `service worker "${manifest.id}" cache for user-private data requires a user partition key`,
    );
  }

  return {
    id: options.id ?? `${manifest.id}:${options.name}`,
    workerId: manifest.id,
    kind: manifest.kind,
    name: options.name,
    privacy: manifest.privacy,
    cancellable: options.cancellable ?? manifest.kind !== "service-worker",
    payload: options.payload,
    traceId: options.traceId,
    cacheKey: options.cacheKey,
  };
}

export function isBrowserWorker(manifestInput: unknown): boolean {
  const manifest = assertWorkerManifest(manifestInput);
  return (
    manifest.kind === "dedicated-worker" ||
    manifest.kind === "shared-worker" ||
    manifest.kind === "service-worker"
  );
}

export function workerRuntimeLabel(manifestInput: unknown): string {
  const manifest = assertWorkerManifest(manifestInput);
  if (manifest.kind === "server-background") return "server background";
  if (manifest.kind === "queue-worker") return "queue worker";
  return manifest.kind.replace("-", " ");
}

function policyIssuesForWorkerManifest(manifest: WorkerManifest): string[] {
  const issues: string[] = [];

  if (manifest.kind === "service-worker" && !manifest.scope) {
    issues.push(`service worker "${manifest.id}" must declare scope`);
  }

  if (
    manifest.kind === "service-worker" &&
    manifest.privacy === "user-private" &&
    manifest.cachePolicy?.ttl
  ) {
    issues.push(
      `service worker "${manifest.id}" cannot ttl-cache user-private data by default`,
    );
  }

  if (
    (manifest.kind === "server-background" ||
      manifest.kind === "queue-worker") &&
    manifest.scope
  ) {
    issues.push(`${manifest.kind} "${manifest.id}" must not declare scope`);
  }

  return issues;
}
