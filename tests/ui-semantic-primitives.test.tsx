import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusBadge as SharedStatusBadge } from "@/components/shared/status-badge";
import { StatusPill } from "@/components/ui/primitives";
import {
  ActionSummary,
  Alert,
  InlineFeedback,
  StatusBadge,
  type SemanticTone,
} from "@/components/ui/semantic-primitives";

describe("StatusBadge", () => {
  it.each<SemanticTone>([
    "neutral",
    "information",
    "success",
    "attention",
    "blocking",
  ])("renders a textual %s state", (tone) => {
    const html = renderToStaticMarkup(
      <StatusBadge tone={tone}>{tone} label</StatusBadge>,
    );

    expect(html).toContain(`ui-status-badge--${tone}`);
    expect(html).toContain(`${tone} label`);
    expect(html).toContain(`data-semantic-tone="${tone}"`);
  });

  it("keeps an optional icon decorative because the status is written in text", () => {
    const html = renderToStaticMarkup(
      <StatusBadge tone="success" icon={<svg data-testid="status-icon" />}>
        Ready
      </StatusBadge>,
    );

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("Ready");
  });
});

describe("Alert", () => {
  it("announces blocking content and preserves a direct action", () => {
    const html = renderToStaticMarkup(
      <Alert
        tone="blocking"
        title="Attendance must be fixed"
        action={<a href="/attendance">Fix attendance</a>}
      >
        One record has no clock-out.
      </Alert>,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Attendance must be fixed");
    expect(html).toContain("One record has no clock-out.");
    expect(html).toContain("Fix attendance");
  });

  it("uses a labelled region for non-blocking guidance", () => {
    const html = renderToStaticMarkup(
      <Alert tone="information" title="Export detail">
        The export contains the exact approved revision.
      </Alert>,
    );

    expect(html).toContain('role="region"');
    expect(html).toContain('aria-labelledby=');
  });
});

describe("InlineFeedback", () => {
  it("announces pending and successful feedback politely", () => {
    const pending = renderToStaticMarkup(
      <InlineFeedback status="pending">Saving</InlineFeedback>,
    );
    const success = renderToStaticMarkup(
      <InlineFeedback status="success">Saved</InlineFeedback>,
    );

    expect(pending).toContain('role="status"');
    expect(pending).toContain('aria-live="polite"');
    expect(success).toContain('role="status"');
    expect(success).toContain('aria-live="polite"');
  });

  it("announces failed feedback assertively", () => {
    const html = renderToStaticMarkup(
      <InlineFeedback status="error">Save failed</InlineFeedback>,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
  });
});

describe("ActionSummary", () => {
  it("renders supplied priority order, textual severity and direct actions", () => {
    const html = renderToStaticMarkup(
      <ActionSummary
        title="Needs attention"
        items={[
          {
            key: "attendance",
            label: "Attendance blockers",
            count: 3,
            tone: "blocking",
            href: "/attendance?status=open",
            actionLabel: "Fix attendance",
          },
          {
            key: "leave",
            label: "Leave requests",
            count: 2,
            tone: "attention",
          },
        ]}
      />,
    );

    expect(html.indexOf("Attendance blockers")).toBeLessThan(
      html.indexOf("Leave requests"),
    );
    expect(html).toContain('data-semantic-tone="blocking"');
    expect(html).toContain("Fix attendance");
    expect(html).toContain('href="/attendance?status=open"');
  });
});

describe("legacy status compatibility", () => {
  it.each([
    ["green", "success"],
    ["amber", "attention"],
    ["red", "blocking"],
    ["grey", "neutral"],
    ["purple", "information"],
  ] as const)("maps %s to the %s semantic state", (legacyTone, semanticTone) => {
    const html = renderToStaticMarkup(
      <StatusPill tone={legacyTone}>{legacyTone} state</StatusPill>,
    );

    expect(html).toContain(`${legacyTone} state`);
    expect(html).toContain(`data-semantic-tone="${semanticTone}"`);
  });

  it("preserves the shared StatusBadge compatibility export", () => {
    const html = renderToStaticMarkup(
      <SharedStatusBadge tone="green">Approved</SharedStatusBadge>,
    );

    expect(html).toContain("Approved");
    expect(html).toContain('data-semantic-tone="success"');
  });
});

describe("commercial UI design-system documentation", () => {
  it("records semantic, responsive and authority boundaries", () => {
    const documentation = readFileSync(
      resolve(process.cwd(), "docs/commercial/ui-design-system.md"),
      "utf8",
    );

    for (const tone of [
      "neutral",
      "information",
      "success",
      "attention",
      "blocking",
    ]) {
      expect(documentation).toContain(`\`${tone}\``);
    }
    expect(documentation).toContain("44px");
    expect(documentation).toContain("Desktop: overview, comparison and bulk operations");
    expect(documentation).toContain("Mobile: lookup, focused decision and individual action");
    expect(documentation).toContain("server-authoritative");
  });
});
