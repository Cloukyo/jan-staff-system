import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/onboarding/initial-staffing.tsx", "utf8");
const page = readFileSync("src/app/onboarding/staffing/page.tsx", "utf8");
const styles = readFileSync("src/app/platform.css", "utf8");

describe("commercial initial staffing UI contract", () => {
  it("offers explicit manual and preview-first CSV paths", () => {
    expect(source).toContain("Add one person");
    expect(source).toContain("Import a CSV");
    expect(source).toContain("Upload and review");
    expect(source).toContain("Import reviewed rows");
    expect(source).toContain("Download the CSV template");
  });

  it("makes non-actions and later attendance boundaries clear", () => {
    expect(page).toContain("Accounts, invitations, PINs and attendance history are not created");
    expect(source).toContain("Kiosk access stays disabled and no PIN is created");
    expect(source).toContain("never creates a PIN, enables a kiosk, sends an invitation or starts the trial clock");
    expect(source).not.toMatch(/nursery|preschool|jan staff/i);
  });

  it("has deliberate mobile, focus and review-table affordances", () => {
    expect(source).toContain('role="tablist"');
    expect(source).toContain('role="region"');
    expect(styles).toMatch(/staffing-paths button\[aria-selected="true"\]/);
    expect(styles).toMatch(/@media \(max-width: 640px\)[\s\S]*staffing-summary/);
  });
});
