/**
 * Minimal JSON-Schema-subset validator for MCP tool arguments (audit
 * contract M5). Covers exactly what the `inputSchema`s in `tools.ts`
 * declare — `type` (object/array/string/number/integer/boolean/null),
 * `required`, `properties`, `items`, `enum` — plus `additionalProperties:
 * false` for completeness. Standard JSON-Schema semantics apply: properties
 * not listed in `properties` are allowed unless `additionalProperties` is
 * explicitly `false`.
 *
 * `@mvp/interaction` ships the same validator subset
 * (`validateInteractionPayload`), but importing it would drag
 * `@mvp/contracts` (and zod) into this package — `@mvp/mcp` is
 * dependency-free by design (see `server.ts`), so the subset is re-derived
 * here instead.
 *
 * Returns the first violation as a human-readable string carrying the
 * violation path and the expected type/values, or `undefined` when the value
 * conforms. Never coerces: a wrong-typed value is a reported violation, not
 * a silently dropped argument.
 */
export function findSchemaViolation(
  schema: Record<string, unknown>,
  value: unknown,
  path = "arguments",
): string | undefined {
  const type = schema.type;
  if (typeof type === "string") {
    const typeError = checkType(type, value, path);
    if (typeError) return typeError;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((v) => v === value)) {
    return `${path} must be one of: ${schema.enum.map((v) => JSON.stringify(v)).join(", ")} (got ${JSON.stringify(value)})`;
  }
  if (isPlainObject(value)) {
    const properties = isPlainObject(schema.properties)
      ? schema.properties
      : undefined;
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === "string" && !(key in value)) {
          return `${path} is missing required property "${key}"`;
        }
      }
    }
    if (properties) {
      for (const [key, childSchema] of Object.entries(properties)) {
        if (!(key in value) || !isPlainObject(childSchema)) continue;
        const childError = findSchemaViolation(
          childSchema,
          value[key],
          `${path}.${key}`,
        );
        if (childError) return childError;
      }
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!(key in properties)) {
            return `${path} has unexpected additional property "${key}"`;
          }
        }
      }
    }
  }
  if (Array.isArray(value) && isPlainObject(schema.items)) {
    for (let index = 0; index < value.length; index += 1) {
      const itemError = findSchemaViolation(
        schema.items,
        value[index],
        `${path}[${index}]`,
      );
      if (itemError) return itemError;
    }
  }
  return undefined;
}

function checkType(
  type: string,
  value: unknown,
  path: string,
): string | undefined {
  const ok =
    (type === "object" && isPlainObject(value)) ||
    (type === "array" && Array.isArray(value)) ||
    (type === "string" && typeof value === "string") ||
    (type === "number" && typeof value === "number") ||
    (type === "integer" && Number.isInteger(value)) ||
    (type === "boolean" && typeof value === "boolean") ||
    (type === "null" && value === null);
  return ok
    ? undefined
    : `${path} must be of type ${type} (got ${describe(value)})`;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
