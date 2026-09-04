import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DetailDisclosure,
  FormActions,
  PageHeader,
  ResponsiveDataView,
} from "@/components/ui/layout-primitives";

describe("PageHeader", () => {
  it("gives a page one clear title, description and action area", () => {
    const html = renderToStaticMarkup(
      <PageHeader
        eyebrow="Workforce Platform"
        title="Attendance review"
        description="Review recorded time."
        actions={<button type="button">Export</button>}
      />,
    );

    expect(html).toContain("<h1");
    expect(html).toContain("Attendance review");
    expect(html).toContain("Review recorded time.");
    expect(html).toContain("Workforce Platform");
    expect(html).toContain("ui-page-header__actions");
  });
});

describe("FormActions", () => {
  it("keeps secondary, destructive and primary controls in predictable DOM order", () => {
    const html = renderToStaticMarkup(
      <FormActions
        secondary={<button type="button">Cancel</button>}
        destructive={<button type="button">Delete</button>}
        primary={<button type="submit">Save</button>}
      />,
    );

    expect(html.indexOf("Cancel")).toBeLessThan(html.indexOf("Delete"));
    expect(html.indexOf("Delete")).toBeLessThan(html.indexOf("Save"));
    expect(html).toContain("ui-form-actions__primary");
  });
});

describe("DetailDisclosure", () => {
  it("uses native disclosure semantics with a visible summary", () => {
    const html = renderToStaticMarkup(
      <DetailDisclosure summary="Audit details">
        <p>Revision 4</p>
      </DetailDisclosure>,
    );

    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain("Audit details");
    expect(html).toContain("Revision 4");
  });
});

describe("ResponsiveDataView", () => {
  it("labels equivalent desktop and mobile presentations", () => {
    const html = renderToStaticMarkup(
      <ResponsiveDataView
        label="Staff readiness"
        desktop={<table><tbody /></table>}
        mobile={<ol><li>Ready</li></ol>}
      />,
    );

    expect(html).toContain('aria-label="Staff readiness"');
    expect(html).toContain("ui-responsive-data__desktop");
    expect(html).toContain("ui-responsive-data__mobile");
    expect(html).toContain("<table");
    expect(html).toContain("Ready");
  });
});
