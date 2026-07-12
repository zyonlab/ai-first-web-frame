import { describe, expect, it } from "vitest";
import { findSchemaViolation } from "./validate";

const schema = {
  type: "object",
  required: ["name"],
  properties: {
    name: { type: "string" },
    count: { type: "number" },
    tags: { type: "array", items: { type: "string" } },
    channel: { type: "string", enum: ["canary", "stable"] },
    flag: { type: "boolean" },
  },
} as const;

describe("findSchemaViolation", () => {
  it("accepts a conforming value", () => {
    expect(
      findSchemaViolation(schema, {
        name: "price-panel",
        count: 3,
        tags: ["a", "b"],
        channel: "canary",
        flag: true,
      }),
    ).toBeUndefined();
  });

  it("reports a wrong-typed property with its path and expected type", () => {
    expect(findSchemaViolation(schema, { name: 123 })).toBe(
      "arguments.name must be of type string (got number)",
    );
    expect(findSchemaViolation(schema, { name: "x", flag: "true" })).toBe(
      "arguments.flag must be of type boolean (got string)",
    );
  });

  it("reports a missing required property", () => {
    expect(findSchemaViolation(schema, {})).toBe(
      'arguments is missing required property "name"',
    );
  });

  it("rejects a non-object at the root when type is object", () => {
    expect(findSchemaViolation(schema, "nope")).toBe(
      "arguments must be of type object (got string)",
    );
    expect(findSchemaViolation(schema, [])).toBe(
      "arguments must be of type object (got array)",
    );
  });

  it("reports enum violations with the allowed values", () => {
    expect(findSchemaViolation(schema, { name: "x", channel: "prod" })).toBe(
      'arguments.channel must be one of: "canary", "stable" (got "prod")',
    );
  });

  it("walks array items with an indexed path", () => {
    expect(findSchemaViolation(schema, { name: "x", tags: ["ok", 7] })).toBe(
      "arguments.tags[1] must be of type string (got number)",
    );
    expect(findSchemaViolation(schema, { name: "x", tags: "not-array" })).toBe(
      "arguments.tags must be of type array (got string)",
    );
  });

  it("allows extra keys by default (JSON-Schema semantics: additionalProperties omitted)", () => {
    expect(
      findSchemaViolation(schema, { name: "x", somethingExtra: 42 }),
    ).toBeUndefined();
  });

  it("rejects extra keys only when additionalProperties is explicitly false", () => {
    expect(
      findSchemaViolation(
        { ...schema, additionalProperties: false },
        { name: "x", somethingExtra: 42 },
      ),
    ).toBe('arguments has unexpected additional property "somethingExtra"');
  });
});
