import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptyState, Field } from "@/components/ui/primitives";

describe("shared form and empty-state accessibility", () => {
  it("associates a validation error with its form control", () => {
    const html = renderToStaticMarkup(
      <Field label="Email" error="Enter a valid email address">
        <input name="email" />
      </Field>,
    );

    const errorId = html.match(/id="([^"]+-error)"/)?.[1];
    expect(errorId).toBeTruthy();
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain(`aria-describedby="${errorId}"`);
    expect(html).toContain('role="alert"');
  });

  it("renders an empty state as a labelled section with a heading", () => {
    const html = renderToStaticMarkup(
      <EmptyState title="No staff yet" body="Add the first member of staff to begin." />,
    );

    const titleId = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(titleId).toBeTruthy();
    expect(html).toContain(`<h2 id="${titleId}"`);
  });
});

describe("application shell keyboard access", () => {
  const shell = readFileSync(
    resolve(process.cwd(), "src/components/layout/app-shell.tsx"),
    "utf8",
  );

  it("provides a visible-on-focus skip link to the main content", () => {
    expect(shell).toContain('href="#main-content"');
    expect(shell).toContain('id="main-content"');
    expect(shell).toContain("app-shell__skip-link");
  });

  it("does not turn arrow keys on links and buttons into page scrolling", () => {
    expect(shell).toContain('target.closest("a, button, input, textarea, select, summary');
    expect(shell).not.toContain('event.key === "ArrowDown"');
    expect(shell).not.toContain('event.key === "ArrowUp"');
  });

  it("keeps navigation menu icons decorative", () => {
    expect(shell).toContain('<Menu aria-hidden="true"');
    expect(shell).toContain('<X aria-hidden="true"');
  });
});

describe("compliance accessibility and first-use state", () => {
  const demo = readFileSync(
    resolve(process.cwd(), "src/components/compliance/staff-compliance-screen.tsx"),
    "utf8",
  );
  const production = readFileSync(
    resolve(process.cwd(), "src/components/compliance/production-compliance-screen.tsx"),
    "utf8",
  );

  it("names filters and quick-edit fields for the affected staff member", () => {
    expect(demo).toContain('aria-label="Search staff compliance"');
    expect(demo).toContain('aria-label="Filter staff compliance"');
    for (const source of [demo, production]) {
      expect(source).toContain('aria-label={`Role for ${person.fullName}`}');
      expect(source).toContain('aria-label={`Qualification for ${person.fullName}`}');
    }
  });

  it("gives an empty production register a purpose and next action", () => {
    expect(production).toContain('title="No staff records yet"');
    expect(production).toContain('href="/staff?action=add"');
    expect(production).toContain("Add the first staff record");
  });

  it("uses meaningful textual metric states", () => {
    expect(production).not.toContain(">Live</StatusPill>");
    expect(demo).not.toContain(">Manager alert</StatusPill>");
    for (const source of [demo, production]) {
      expect(source).toContain('tone === "purple" ? "Current"');
      expect(source).toContain('tone === "amber" ? "Due soon" : "Needs attention"');
    }
  });
});

describe("demo workflow control names", () => {
  const demoApp = readFileSync(
    resolve(process.cwd(), "src/components/app/prototype-app.tsx"),
    "utf8",
  );

  it("names the staff directory search and filters", () => {
    expect(demoApp).toContain('aria-label="Search staff"');
    expect(demoApp).toContain('aria-label="Filter staff by active status"');
    expect(demoApp).toContain('aria-label="Filter staff by pay type"');
  });

  it("names each attendance bulk-selection checkbox by staff member and date", () => {
    expect(demoApp).toContain('aria-label={`Select ${person?.displayName ?? "staff"} on ${formatDateUk(day.date)} for bulk approval`}');
  });
});
