import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256CanonicalJson } from "@/lib/exports/canonical-json";

describe("canonical customer export JSON", () => {
  it("sorts object keys recursively while preserving projection array order", () => {
    const value = {
      z: null,
      nested: { beta: true, alpha: "£49" },
      rows: [{ name: "Second", id: 2 }, { id: 1, name: "First" }],
      a: 1,
    };

    expect(canonicalJson(value)).toBe(
      '{"a":1,"nested":{"alpha":"£49","beta":true},"rows":[{"id":2,"name":"Second"},{"id":1,"name":"First"}],"z":null}',
    );
  });

  it("produces the same digest for semantically equal key orderings", () => {
    const left = { manifest: { version: 1, timezone: "Europe/London" }, data: { sites: [], staff: [] } };
    const right = { data: { staff: [], sites: [] }, manifest: { timezone: "Europe/London", version: 1 } };
    const literal = '{"data":{"sites":[],"staff":[]},"manifest":{"timezone":"Europe/London","version":1}}';
    const expected = createHash("sha256").update(literal, "utf8").digest("hex");

    expect(sha256CanonicalJson(left)).toBe(expected);
    expect(sha256CanonicalJson(right)).toBe(expected);
  });

  it("rejects values that cannot be represented as stable JSON", () => {
    expect(() => canonicalJson({ value: undefined } as never)).toThrow("canonical JSON");
    expect(() => canonicalJson({ value: Number.NaN })).toThrow("canonical JSON");
    expect(() => canonicalJson(new Date("2026-08-18T10:00:00Z") as never)).toThrow("canonical JSON");
  });
});
