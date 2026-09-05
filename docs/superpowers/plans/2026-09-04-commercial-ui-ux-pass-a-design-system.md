# Commercial UI/UX Pass A Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish shared semantic states, page/action structure, form feedback, responsive data and accessible dialog primitives without redesigning feature screens or changing application behaviour.

**Architecture:** Add a small semantic layer alongside the existing UI primitives and global design tokens. Preserve existing component APIs where they are broadly used, provide compatibility wrappers for legacy status components, and migrate only shared components plus one low-risk representative use in this pass. Feature-specific adoption belongs to Passes B-I.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS 4/global CSS, Lucide React, Vitest, Playwright for local browser evidence.

**Spec:** `docs/superpowers/specs/2026-09-04-commercial-ui-ux-improvement-programme-design.md`

## Global Constraints

- Preserve the current purple, lavender and white visual identity.
- Preserve the desktop weekly rota grid, desktop operational density and kiosk workflow.
- Use UK language, dates and Europe/London time.
- Do not change calculations, immutable evidence, corrections, RLS, permissions, tenancy, database behaviour or billing.
- Do not expose pay or manager information on kiosk screens.
- Keep ordinary touch targets at least 44px and kiosk targets larger.
- Never rely on colour alone for status meaning.
- Do not add decorative gradients, glass effects, unnecessary animation, charts or wholesale card conversions.
- Do not add a runtime dependency. A dev-only accessibility dependency requires a separate justified task and is not part of Pass A.
- Use tests first for each behavioural or rendered contract.
- Keep feature migrations out of Pass A except for compatibility wrappers and one representative shared-component adoption.

---

## File structure

### Create

- `src/components/ui/semantic-primitives.tsx`: semantic tone type, status badge, alert, inline feedback and action-summary presentation.
- `src/components/ui/layout-primitives.tsx`: page header, form actions, responsive data view and detail disclosure.
- `src/components/ui/dialog.tsx`: accessible controlled dialog with focus containment and focus return.
- `tests/ui-semantic-primitives.test.tsx`: rendered semantic, label and structure contracts.
- `tests/ui-layout-primitives.test.tsx`: rendered page, form, disclosure and responsive-data contracts.
- `tests/ui-dialog-interface.test.ts`: dialog accessibility and keyboard contract.
- `docs/commercial/ui-design-system.md`: concise maintenance reference for the semantic and interaction system.

### Modify

- `src/app/platform.css`: semantic colour/surface tokens and scoped shared primitive styles.
- `src/components/ui/primitives.tsx`: export compatibility aliases and extend existing empty-state options without breaking call sites.
- `src/components/shared/status-badge.tsx`: map existing status values to the semantic status badge.
- `src/components/shared/empty-state.tsx`: delegate to the shared empty-state primitive while preserving its current public API.
- `tests/navigation.test.ts`: assert the shared page/action hierarchy does not regress existing mobile navigation behaviour only if imports require a fixture update.

### Explicitly unchanged in Pass A

- Dashboard, attendance, payroll, rota, compliance, leave, staff, onboarding and kiosk feature logic.
- Supabase migrations, repositories, actions, calculations and route permissions.
- Primary navigation destinations or labels.

---

### Task 1: Semantic state model and status badge

**Files:**
- Create: `tests/ui-semantic-primitives.test.tsx`
- Create: `src/components/ui/semantic-primitives.tsx`
- Modify: `src/app/platform.css`

**Interfaces:**
- Produces: `export type SemanticTone = "neutral" | "information" | "success" | "attention" | "blocking"`
- Produces: `StatusBadge({ tone, children, icon?, className? })`
- Produces CSS hooks: `.ui-status-badge`, `.ui-status-badge--neutral`, `.ui-status-badge--information`, `.ui-status-badge--success`, `.ui-status-badge--attention`, `.ui-status-badge--blocking`

- [ ] **Step 1: Write the failing semantic badge tests**

Create a Vitest test that renders each badge with `renderToStaticMarkup` and asserts visible text plus semantic metadata:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusBadge, type SemanticTone } from "@/components/ui/semantic-primitives";

describe("StatusBadge", () => {
  it.each<SemanticTone>(["neutral", "information", "success", "attention", "blocking"])(
    "renders a textual %s state",
    (tone) => {
      const html = renderToStaticMarkup(<StatusBadge tone={tone}>{tone} label</StatusBadge>);
      expect(html).toContain(`ui-status-badge--${tone}`);
      expect(html).toContain(`${tone} label`);
      expect(html).toContain(`data-semantic-tone="${tone}"`);
    },
  );
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npm test -- tests/ui-semantic-primitives.test.tsx`

Expected: FAIL because `semantic-primitives.tsx` does not exist.

- [ ] **Step 3: Add semantic CSS tokens**

Add tokens under the existing root token block. Values must meet normal-text contrast when used as specified:

```css
--status-neutral-bg: #f2f4f7;
--status-neutral-border: #d0d5dd;
--status-neutral-text: #344054;
--status-information-bg: #eef4ff;
--status-information-border: #b2ccff;
--status-information-text: #1849a9;
--status-success-bg: #ecfdf3;
--status-success-border: #abefc6;
--status-success-text: #067647;
--status-attention-bg: #fffaeb;
--status-attention-border: #fedf89;
--status-attention-text: #93370d;
--status-blocking-bg: #fef3f2;
--status-blocking-border: #fecdca;
--status-blocking-text: #b42318;
--focus-ring: #7f56d9;
```

Add one compact badge base class and tone modifiers. The base class uses inline-flex, visible text, a 1px border, 999px radius, 12px bold text and a minimum 24px height. Do not animate state changes.

- [ ] **Step 4: Implement the semantic type and badge**

Use a plain server-compatible component. When `icon` is supplied, wrap it in an `aria-hidden` span because the visible text carries the meaning.

```tsx
export type SemanticTone = "neutral" | "information" | "success" | "attention" | "blocking";

export function StatusBadge({ tone, children, icon, className = "" }: StatusBadgeProps) {
  return (
    <span
      className={`ui-status-badge ui-status-badge--${tone} ${className}`.trim()}
      data-semantic-tone={tone}
    >
      {icon ? <span aria-hidden="true" className="ui-status-badge__icon">{icon}</span> : null}
      <span>{children}</span>
    </span>
  );
}
```

- [ ] **Step 5: Run the semantic badge tests**

Run: `npm test -- tests/ui-semantic-primitives.test.tsx`

Expected: PASS for all five semantic tones.

- [ ] **Step 6: Commit the state foundation**

```powershell
git add src/app/platform.css src/components/ui/semantic-primitives.tsx tests/ui-semantic-primitives.test.tsx
git commit -m "Add semantic UI status foundation"
```

---

### Task 2: Alerts, feedback and action summaries

**Files:**
- Modify: `tests/ui-semantic-primitives.test.tsx`
- Modify: `src/components/ui/semantic-primitives.tsx`
- Modify: `src/app/platform.css`

**Interfaces:**
- Produces: `Alert({ tone, title, children, action? })`
- Produces: `InlineFeedback({ status, children })` where `status` is `"pending" | "success" | "error"`
- Produces: `ActionSummary({ title, items })`
- Produces: `ActionSummaryItem = { key: string; label: string; count: number; tone: SemanticTone; href?: string; actionLabel?: string }`

- [ ] **Step 1: Add failing rendered tests**

Add tests that prove:

```tsx
const alert = renderToStaticMarkup(
  <Alert tone="blocking" title="Attendance must be fixed" action={<a href="/attendance">Fix attendance</a>}>
    One record has no clock-out.
  </Alert>,
);
expect(alert).toContain('role="alert"');
expect(alert).toContain("Attendance must be fixed");
expect(alert).toContain("Fix attendance");

const success = renderToStaticMarkup(<InlineFeedback status="success">Saved</InlineFeedback>);
expect(success).toContain('role="status"');
expect(success).toContain('aria-live="polite"');

const failure = renderToStaticMarkup(<InlineFeedback status="error">Save failed</InlineFeedback>);
expect(failure).toContain('role="alert"');
expect(failure).toContain('aria-live="assertive"');
```

Add an `ActionSummary` assertion that the highest consequence item remains text-labelled and a linked item exposes its explicit action label.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npm test -- tests/ui-semantic-primitives.test.tsx`

Expected: FAIL because the three new exports do not exist.

- [ ] **Step 3: Implement alerts and feedback**

Rules:

- `blocking` uses `role="alert"`; other alert tones use a labelled region.
- Pending and success feedback use polite live announcements.
- Error feedback uses an assertive alert.
- Alerts always render a title and body; they never use icon-only meaning.
- Action content appears after the explanation in DOM order.

- [ ] **Step 4: Implement the action summary**

Render a labelled list, not decorative metric cards. Each item contains count, label and optional direct action. Sort order is supplied by the feature view model; the component must not infer domain priority.

- [ ] **Step 5: Add scoped CSS**

Add `.ui-alert`, `.ui-inline-feedback` and `.ui-action-summary` classes using the semantic tokens. Keep density suitable for operational screens and stack item actions below copy at widths below 640px.

- [ ] **Step 6: Run the focused tests**

Run: `npm test -- tests/ui-semantic-primitives.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/app/platform.css src/components/ui/semantic-primitives.tsx tests/ui-semantic-primitives.test.tsx
git commit -m "Add shared alerts and action summaries"
```

---

### Task 3: Page, form, disclosure and responsive-data structure

**Files:**
- Create: `tests/ui-layout-primitives.test.tsx`
- Create: `src/components/ui/layout-primitives.tsx`
- Modify: `src/app/platform.css`

**Interfaces:**
- Produces: `PageHeader({ eyebrow?, title, description?, actions? })`
- Produces: `FormActions({ primary, secondary?, destructive? })`
- Produces: `DetailDisclosure({ summary, children, defaultOpen? })`
- Produces: `ResponsiveDataView({ label, desktop, mobile })`

- [ ] **Step 1: Write failing structure tests**

Use static rendering to assert:

```tsx
const header = renderToStaticMarkup(
  <PageHeader title="Attendance review" description="Review recorded time." actions={<button>Export</button>} />,
);
expect(header).toContain("<h1");
expect(header).toContain("Attendance review");
expect(header).toContain("Review recorded time.");

const disclosure = renderToStaticMarkup(
  <DetailDisclosure summary="Audit details"><p>Revision 4</p></DetailDisclosure>,
);
expect(disclosure).toContain("<details");
expect(disclosure).toContain("<summary");

const responsive = renderToStaticMarkup(
  <ResponsiveDataView label="Staff readiness" desktop={<table><tbody /></table>} mobile={<ol><li>Ready</li></ol>} />,
);
expect(responsive).toContain('aria-label="Staff readiness"');
expect(responsive).toContain("ui-responsive-data__desktop");
expect(responsive).toContain("ui-responsive-data__mobile");
```

Assert `FormActions` emits secondary, destructive and primary groups in that DOM order while CSS controls visual alignment. This preserves predictable screen-reader order.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/ui-layout-primitives.test.tsx`

Expected: FAIL because `layout-primitives.tsx` does not exist.

- [ ] **Step 3: Implement the layout primitives**

Implementation rules:

- `PageHeader` owns the page `h1`; feature sections must not use it.
- `FormActions` accepts rendered controls so it does not duplicate server/client form logic.
- `DetailDisclosure` uses native `details/summary` and has a visible keyboard focus state.
- `ResponsiveDataView` renders both presentations but CSS displays desktop at 768px and above, mobile below 768px. Feature authors must ensure duplicate interactive controls cannot submit twice; in feature migrations, use a shared action handler or mutually exclusive CSS/DOM rendering when required.

- [ ] **Step 4: Add scoped responsive CSS**

Add page-header, form-action, disclosure and responsive-data rules. Form actions stack full-width below 480px. Page header action controls wrap without horizontal overflow. The desktop/mobile switch must not affect print: desktop content is used for print.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- tests/ui-layout-primitives.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/app/platform.css src/components/ui/layout-primitives.tsx tests/ui-layout-primitives.test.tsx
git commit -m "Add shared UI layout patterns"
```

---

### Task 4: Accessible controlled dialog

**Files:**
- Create: `tests/ui-dialog-interface.test.ts`
- Create: `src/components/ui/dialog.tsx`
- Modify: `src/app/platform.css`

**Interfaces:**
- Produces: `Dialog({ open, title, description?, onClose, children, initialFocusRef?, closeLabel? })`
- Behaviour: focus enters the dialog, Tab/Shift+Tab remain inside, Escape closes when enabled, body scrolling is restored, and focus returns to the trigger active before opening.

- [ ] **Step 1: Write the failing source-contract test**

Follow the repository's focused interface-test convention and assert the source contains:

```ts
expect(source).toContain('role="dialog"');
expect(source).toContain('aria-modal="true"');
expect(source).toContain("aria-labelledby");
expect(source).toContain("aria-describedby");
expect(source).toContain('event.key === "Escape"');
expect(source).toContain('event.key !== "Tab"');
expect(source).toContain("previouslyFocused.current?.focus()");
```

Also assert the close control receives a visible textual `aria-label` and the component renders nothing when `open` is false.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/ui-dialog-interface.test.ts`

Expected: FAIL because `dialog.tsx` does not exist.

- [ ] **Step 3: Implement focus and lifecycle behaviour**

Use `useId`, `useEffect`, `useRef` and a root dialog ref. Query focusable controls with one local selector constant. On open:

1. Save `document.activeElement` when it is an `HTMLElement`.
2. Set body overflow to `hidden`, preserving the previous value.
3. Focus `initialFocusRef.current`, otherwise the first focusable element, otherwise the dialog container.
4. Handle Escape and Tab containment.
5. Restore body overflow, remove listeners and return focus on cleanup.

Do not close on backdrop click by default because payroll, staff and rota editors may contain unsaved work.

- [ ] **Step 4: Implement the rendered dialog structure**

The title and optional description receive generated IDs. The panel has `tabIndex={-1}` and `role="dialog"`. The close button is always available unless a later explicitly approved pending-action variant disables it.

- [ ] **Step 5: Add dialog CSS**

Use a fixed backdrop, bounded `max-height`, internal overflow, 16px mobile margins and a desktop width no larger than the current wide staff editor. Respect reduced motion by not requiring an entrance animation.

- [ ] **Step 6: Run focused tests**

Run: `npm test -- tests/ui-dialog-interface.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/app/platform.css src/components/ui/dialog.tsx tests/ui-dialog-interface.test.ts
git commit -m "Add accessible shared dialog primitive"
```

---

### Task 5: Compatibility wrappers and empty states

**Files:**
- Modify: `src/components/ui/primitives.tsx`
- Modify: `src/components/shared/status-badge.tsx`
- Modify: `src/components/shared/empty-state.tsx`
- Modify: `tests/ui-semantic-primitives.test.tsx`
- Modify: `tests/ui-layout-primitives.test.tsx`

**Interfaces:**
- Existing `StatusPill` public calls remain valid.
- Existing shared `StatusBadge` props remain valid and map to semantic tones.
- Existing `EmptyState` calls remain valid.
- Extended empty state supports optional `action` and `kind: "first-use" | "filtered" | "default"`.

- [ ] **Step 1: Add failing compatibility tests**

Import the existing shared components and assert:

- Existing status values render their same visible labels.
- `critical`/error-like values map to `blocking`.
- warning/expiring/pending values map to `attention`.
- active/approved/complete values map to `success`.
- neutral draft/inactive values map to `neutral`.
- Empty state with no new props renders unchanged title/body.
- Empty state with an action renders the action after the body.

- [ ] **Step 2: Run and confirm the new assertions fail**

Run: `npm test -- tests/ui-semantic-primitives.test.tsx tests/ui-layout-primitives.test.tsx`

Expected: FAIL because wrappers do not yet use the new semantic primitives and action support is absent.

- [ ] **Step 3: Implement non-breaking wrappers**

Keep legacy prop names and exports. Centralise status-to-semantic mapping in `status-badge.tsx`; do not duplicate business readiness calculations. Extend existing empty state markup using optional props only.

- [ ] **Step 4: Run focused and existing shared UI tests**

Run: `npm test -- tests/ui-semantic-primitives.test.tsx tests/ui-layout-primitives.test.tsx tests/navigation.test.ts`

Expected: PASS with no existing call-site changes.

- [ ] **Step 5: Commit**

```powershell
git add src/components/ui/primitives.tsx src/components/shared/status-badge.tsx src/components/shared/empty-state.tsx tests/ui-semantic-primitives.test.tsx tests/ui-layout-primitives.test.tsx tests/navigation.test.ts
git commit -m "Adopt semantic shared UI wrappers"
```

---

### Task 6: Design-system documentation

**Files:**
- Create: `docs/commercial/ui-design-system.md`
- Test: `tests/ui-semantic-primitives.test.tsx`

**Interfaces:**
- Documents the exported primitives, semantic decision rules, button hierarchy, responsive strategy and migration boundary.

- [ ] **Step 1: Add a failing documentation-presence assertion**

Read the documentation in the semantic test and assert it includes the five semantic tones, the desktop/mobile principle, 44px target requirement and the rule that domain readiness remains server-authoritative.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/ui-semantic-primitives.test.tsx`

Expected: FAIL because the documentation file does not exist.

- [ ] **Step 3: Write the maintenance document**

Include:

- Preserved brand tokens and examples.
- Semantic tone decision table.
- `StatusBadge`, `Alert`, `InlineFeedback`, `ActionSummary`, `PageHeader`, `FormActions`, `Dialog`, `DetailDisclosure` and `ResponsiveDataView` APIs.
- One-primary-action rule.
- Concrete confirmation-copy rule.
- Form error and success announcement rules.
- Desktop comparison/bulk and mobile lookup/focused-action principle.
- Explicit statement that feature view models supply authoritative state and ordering.
- Migration guidance for Passes B-I.

- [ ] **Step 4: Run the documentation test**

Run: `npm test -- tests/ui-semantic-primitives.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add docs/commercial/ui-design-system.md tests/ui-semantic-primitives.test.tsx
git commit -m "Document commercial UI design system"
```

---

### Task 7: Pass A visual and technical verification

**Files:**
- No application files expected.
- Generate untracked local evidence under `ux-audit-package/current/pass-a/` using fictional demo data.

**Interfaces:**
- Produces baseline/current screenshots and a concise state manifest for later final-package assembly.

- [ ] **Step 1: Run focused Pass A tests**

Run:

```powershell
npm test -- tests/ui-semantic-primitives.test.tsx tests/ui-layout-primitives.test.tsx tests/ui-dialog-interface.test.ts tests/navigation.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run standard code verification**

Run:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
git diff --check
```

Expected: all commands pass. Pass A has no migration or browser-bundle change, but the full milestone checks remain mandatory later.

- [ ] **Step 3: Start the local candidate in demo mode**

Run: `npm run dev -- --hostname 127.0.0.1 --port 3100`

Expected: local server reports ready. Use only fictional demo data.

- [ ] **Step 4: Capture representative current screenshots**

Use Playwright at 1440 x 1000 and 390 x 844 for:

- `/dashboard`
- `/attendance`
- `/payroll`
- `/rota`
- `/staff`
- `/compliance`
- `/leave/requests`
- `/clock`

Store full-page PNGs under `ux-audit-package/current/pass-a/`. Record route, viewport, state and candidate SHA in `manifest.json`. Assert `scrollWidth === clientWidth` except an explicitly labelled internal rota week scroller.

- [ ] **Step 5: Perform interaction checks**

Open a representative staff or payroll editor locally and verify:

- Focus enters the existing editor as before.
- Escape and close retain expected behaviour.
- New shared CSS does not reduce control size or obscure content.
- Desktop and mobile navigation remain usable.
- Status text remains visible without colour.

The new shared `Dialog` is not yet a feature dependency, so its full browser interaction migration is tested when the first feature adopts it.

- [ ] **Step 6: Stop the local server**

Send Ctrl+C to the same terminal session. Do not leave a background development server running.

- [ ] **Step 7: Inspect the Pass A diff**

Confirm the diff contains only shared UI files, tests and documentation listed in this plan. Any feature logic, calculation, migration or environment change must be removed from this pass without reverting unrelated user work.

- [ ] **Step 8: Create the Pass A integration commit if verification changes remain**

If Tasks 1-6 already produced clean commits and no correction is needed, do not create an empty commit. If verification required a scoped correction, commit only that correction with:

```powershell
git add src/app/platform.css src/components/ui/semantic-primitives.tsx src/components/ui/layout-primitives.tsx src/components/ui/dialog.tsx src/components/ui/primitives.tsx src/components/shared/status-badge.tsx src/components/shared/empty-state.tsx tests/ui-semantic-primitives.test.tsx tests/ui-layout-primitives.test.tsx tests/ui-dialog-interface.test.ts tests/navigation.test.ts docs/commercial/ui-design-system.md
git commit -m "Complete commercial UI design system pass"
```

- [ ] **Step 9: Record the pass boundary**

Report commit SHAs, screenshots, focused/full test results and residual risks. Do not begin Pass B until Pass A is complete and the branch is clean.

---

## Later plan boundaries

After Pass A, create separate implementation plans from the approved design specification for:

1. Pass B: dashboard and navigation.
2. Pass C: attendance.
3. Pass D: payroll.
4. Pass E: rota desktop and mobile.
5. Pass F: compliance and recruitment.
6. Pass G: remaining manager screens.
7. Pass H: staff self-service and kiosk.
8. Pass I: accessibility, responsive and non-happy-path sweep plus final UX package.

Each later plan must name its authoritative view-model inputs, exact routes/components, mobile task contract, baseline states, focused tests, screenshots and commit boundary. Later plans must not reopen approved Pass A semantics unless browser evidence demonstrates a concrete defect.
