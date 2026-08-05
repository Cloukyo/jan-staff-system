import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findSensitiveBrowserMarkers } from "../scripts/verify-browser-bundle.mjs";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("browser bundle sensitive marker scan", () => {
  it("reports a server-only marker in a browser asset", () => {
    const root = mkdtempSync(join(tmpdir(), "browser-scan-"));
    roots.push(root);
    mkdirSync(join(root, "chunks"));
    writeFileSync(join(root, "chunks", "app.js"), "const leaked='fictional-secret-marker'", "utf8");
    expect(findSensitiveBrowserMarkers(root, ["fictional-secret-marker"])).toEqual([expect.stringContaining("app.js")]);
  });

  it("ignores clean browser assets", () => {
    const root = mkdtempSync(join(tmpdir(), "browser-scan-"));
    roots.push(root);
    writeFileSync(join(root, "app.js"), "const publicValue='safe'", "utf8");
    expect(findSensitiveBrowserMarkers(root, ["fictional-secret-marker"])).toEqual([]);
  });
});
