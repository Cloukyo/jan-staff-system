import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
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
