import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/ui/dialog.tsx"),
  "utf8",
);

describe("shared dialog interface", () => {
  it("uses labelled modal semantics and an explicit close name", () => {
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain("aria-labelledby");
    expect(source).toContain("aria-describedby");
    expect(source).toContain("aria-label={closeLabel}");
  });

  it("supports Escape, Tab containment and trigger focus return", () => {
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain('event.key !== "Tab"');
    expect(source).toContain("previouslyFocused.current?.focus()");
    expect(source).toContain("document.body.style.overflow = previousOverflow");
  });

  it("does not render a closed dialog", () => {
    expect(source).toContain("if (!open) return null");
  });
});
