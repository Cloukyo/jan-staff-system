# Commercial UI Design System

This document defines the shared visual and interaction contract for the commercial workforce application. It supplements the product UI/UX design specification and prevents feature teams from recreating status, action, form and responsive patterns independently.

## Foundation

Preserve the existing purple, lavender and white identity, current typography, persistent manager navigation, useful desktop density and simple kiosk interaction. Ordinary interactive targets must be at least 44px high. Kiosk targets should remain larger.

Do not add decorative gradients, glass effects, unnecessary animation or ornamental charts. Operational clarity has priority over novelty.

## Semantic states

Use meaning rather than feature-specific colour names:

| Tone | Meaning | Examples |
| --- | --- | --- |
| `neutral` | No action or consequence implied | Inactive, draft metadata |
| `information` | Context that does not require action | Evidence source, exact export detail |
| `success` | Complete, current or safely approved | Ready, approved, synchronised |
| `attention` | Review is useful or a decision is pending | Due soon, pending leave |
| `blocking` | The workflow cannot safely proceed | Missing required evidence, stale payroll input |

Destructive is an action category, not a record status. Reserve destructive red controls for actions such as deactivate, revoke or clear. Do not rely on colour alone: every state requires visible text, and icons only supplement that text.

Feature view models supply status meaning, priority and ordering. Readiness remains server-authoritative. Shared UI components must not reproduce payroll, attendance, compliance, tenant or permission rules.

## Shared primitives

### `StatusBadge`

Use for short textual states. Supply one semantic tone and a visible label. Optional icons are decorative because the label carries the meaning.

### `Alert`

Use for a bounded explanation and optional direct action. A blocking alert is announced as an alert. Other tones are labelled regions. Keep the title concrete and explain the next safe action.

### `InlineFeedback`

Use beside the action that generated pending, success or failure feedback. Pending and success messages announce politely; failures announce assertively. Preserve entered form values after a recoverable server failure.

### `ActionSummary`

Use for an already-ranked queue of manager work. It renders supplied order and does not calculate domain priority. Link labels name the destination or action, such as `Fix attendance`.

### `PageHeader`

Use once per route for the eyebrow, `h1`, concise purpose and primary page actions. Do not use it for nested sections. Prefer one dominant action in the header.

### `FormActions`

Provide secondary, destructive and primary controls in predictable document order. On narrow screens, controls stack without changing their semantic order.

### `Dialog`

Use for contextual edits that should preserve the underlying screen. Supply a specific title and description, such as staff member plus date. Focus enters the dialog, remains contained while tabbing, closes with Escape where safe and returns to the trigger. Backdrop clicks do not discard form work.

### `DetailDisclosure`

Use native disclosure for audit data, evidence detail and low-frequency metadata. Never hide the reason or action for a current blocker inside disclosure.

### `ResponsiveDataView`

Use when an efficient desktop comparison table needs a focused mobile presentation. Desktop and mobile presentations must expose equivalent information and actions. Print uses the desktop presentation.

### `EmptyState`

Use `first-use` when setup has not begun, `filtered` when current filters yield no matches, and `default` otherwise. Add a direct action only when one clear next step exists.

## Action hierarchy

- Use at most one dominant primary action in a task region.
- Keep ordinary alternatives secondary.
- Keep destructive actions visually separate from ordinary save actions.
- Do not confirm reversible ordinary saves.
- Confirm consequential actions with concrete scope, such as person, date range, record count or week.
- Once payroll is fresh and its exact revision is approved, export should not require an additional generic confirmation.

## Forms

- Keep labels visible; placeholders do not replace labels.
- State required-field expectations before submission where ambiguity exists.
- Place field errors next to their fields and use an accessible summary for long forms.
- Announce successful saves and keep the user in context.
- Identify the edited object in a contextual editor heading.
- Protect unsaved changes only when accidental loss would be material.

## Responsive strategy

Desktop: overview, comparison and bulk operations.

Mobile: lookup, focused decision and individual action.

Mobile may change presentation but must not remove actions needed to complete a reasonable manager workflow. The weekly rota may expose an explicitly labelled horizontal overview, while Day view remains the primary mobile task model.

## Accessibility

- Preserve visible focus and a minimum 44px ordinary target.
- Associate field errors and dialog descriptions programmatically.
- Use text in addition to colour and icons.
- Keep keyboard order aligned with reading and action order.
- Respect reduced-motion preferences.
- Test representative rendered routes and manually complete priority workflows with keyboard and mobile viewport.

## Migration guidance

Adopt these primitives feature by feature during Passes B-I. Do not mechanically replace all current styles. Preserve efficient tables and strong workflows, then migrate only where the semantic or responsive contract improves a user decision. Any required business-rule change is a separate product decision and must not be hidden inside UI work.
