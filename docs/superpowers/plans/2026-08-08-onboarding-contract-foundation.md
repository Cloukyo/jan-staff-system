# Onboarding Contract Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define and test the versioned workflow, step, command, event, and readiness contracts that begin Workstream 7 without implementing onboarding persistence or customer-facing behaviour.

**Architecture:** Add one strict Zod contract module under `src/lib/onboarding` and infer all exported TypeScript types from those runtime schemas. The module owns the canonical `commercial_customer_v1` workflow definition and boundary validation only; later Workstream 7 phases may consume it, but this task creates no tables, RPCs, routes, UI, billing logic, or offline capability.

**Tech Stack:** TypeScript 5, Zod 4, Vitest 4, Next.js path aliases.

## Global Constraints

- Stay on `codex/commercial-production`.
- Do not merge, deploy, connect to Jan production, or alter production configuration.
- Keep offline attendance disabled and outside onboarding contracts.
- Preserve the approved commercial onboarding specification and existing tenancy and attendance architecture.
- Use `commercial_customer_v1`, workflow version `1`, contract schema version `1`, and readiness evaluator version `1`.
- Use decimal strings for persisted `bigint` revisions at JSON boundaries.
- Reject unknown object fields and unsupported contract versions.
- Event metadata may contain only safe structured codes, counts, booleans and nulls; it must reject sensitive field names and free-text personal data.
- Do not add onboarding database tables, RLS, command execution, readiness evaluation, onboarding UI, billing, invitations, imports, kiosk registration, or Go Live behaviour.

---

### Task 1: Workflow and step contracts

**Files:**
- Create: `src/lib/onboarding/contracts.ts`
- Create: `tests/onboarding-contracts.test.ts`

**Interfaces:**
- Produces: `onboardingWorkflowDefinitionSchema`, `onboardingWorkflowStateSchema`, `onboardingStepStateSchema`, `commercialCustomerWorkflowV1`, and their inferred types.
- Consumes: Zod only.

- [x] **Step 1: Write failing workflow-definition tests**

Add tests that import the future contract module and assert that the canonical definition:

```ts
expect(commercialCustomerWorkflowV1).toMatchObject({
  schemaVersion: 1,
  workflowKey: "commercial_customer_v1",
  workflowVersion: 1,
  readinessEvaluatorVersion: 1,
});
expect(commercialCustomerWorkflowV1.steps.reduce(
  (total, step) => total + step.progressWeight,
  0,
)).toBe(100);
```

Also assert that workflow parsing rejects a duplicate step key, a prerequisite that appears after its dependent step, a self-prerequisite, and weights that do not total 100.

- [x] **Step 2: Run the test to verify RED**

Run: `npm test -- tests/onboarding-contracts.test.ts`

Expected: FAIL because `@/lib/onboarding/contracts` does not exist.

- [x] **Step 3: Implement strict workflow and step schemas**

Define:

```ts
export const ONBOARDING_CONTRACT_SCHEMA_VERSION = 1 as const;
export const COMMERCIAL_CUSTOMER_WORKFLOW_KEY = "commercial_customer_v1" as const;
export const COMMERCIAL_CUSTOMER_WORKFLOW_VERSION = 1 as const;
export const ONBOARDING_READINESS_EVALUATOR_VERSION = 1 as const;
```

The canonical ordered steps are `owner_account`, `organisation`, `first_site`, `subscription`, `settings`, `staff`, `manager_invitations`, `staff_invitations`, `kiosk`, `initial_rota`, `readiness`, and `go_live`. `initial_rota` is optional with zero weight. `go_live` has zero weight and depends on readiness. The ten approved progress milestones total 100. The v1 parser requires this exact ordered definition and step version 1 so an incompatible subset cannot claim the same workflow version.

Workflow and step state schemas must use the approved status enums, UUID identifiers, offset timestamps, nullable organisation and Go Live fields, safe JSON draft data, validation issue codes, and non-negative decimal-string revisions.

- [x] **Step 4: Run focused tests to verify GREEN**

Run: `npm test -- tests/onboarding-contracts.test.ts`

Expected: workflow and step tests pass.

### Task 2: Command and event contracts

**Files:**
- Modify: `src/lib/onboarding/contracts.ts`
- Modify: `tests/onboarding-contracts.test.ts`

**Interfaces:**
- Produces: `onboardingCommandSchema`, `onboardingCommandResultSchema`, `onboardingEventSchema`, and inferred command/event types.
- Consumes: shared workflow keys, version constants, decimal revision schema, and JSON-value schema from Task 1.

- [x] **Step 1: Write failing command and event tests**

Test hand-written fixtures showing that:

```ts
expect(onboardingCommandSchema.parse(validCommand)).toEqual(validCommand);
expect(() => onboardingCommandSchema.parse({ ...validCommand, schemaVersion: 2 })).toThrow();
expect(() => onboardingCommandSchema.parse({ ...validCommand, unexpected: true })).toThrow();
```

Test that command results always state whether data was saved and use stable outcome and reason codes. Test an approved event fixture and rejection of metadata keys or values containing passwords, tokens, PINs, email addresses, personal names, postal addresses, payment data, or raw import rows.

- [x] **Step 2: Run focused tests to verify RED**

Run: `npm test -- tests/onboarding-contracts.test.ts`

Expected: FAIL because command and event exports are missing.

- [x] **Step 3: Implement minimal strict command and event schemas**

Use the approved conceptual command boundary:

```ts
type OnboardingCommand = {
  schemaVersion: 1;
  workflowKey: "commercial_customer_v1";
  workflowVersion: 1;
  sessionId: string;
  commandType: OnboardingCommandType;
  idempotencyKey: string;
  expectedSessionRevision: string;
  payload: JsonObject;
};
```

Command outcomes distinguish success, replay, validation failure, stale workflow, permission or capability denial, retryable failure, and support-required indeterminate state. Results include `dataState` as `saved`, `not_saved`, or `unknown`, a safe result reference, the current session revision, and structured issues. Only indeterminate outcomes use `unknown`; this prevents unsafe retry when commit state requires reconciliation.

Events use the approved taxonomy and actor types, carry workflow and event versions, and accept only an explicit allowlist of privacy-safe metadata fields and types. Keep event metadata separate from command payload because command payloads may legitimately contain customer data while event metadata must not.

- [x] **Step 4: Run focused tests to verify GREEN**

Run: `npm test -- tests/onboarding-contracts.test.ts`

Expected: command and event tests pass.

### Task 3: Readiness contracts and invariants

**Files:**
- Modify: `src/lib/onboarding/contracts.ts`
- Modify: `tests/onboarding-contracts.test.ts`

**Interfaces:**
- Produces: `onboardingReadinessItemSchema`, `onboardingReadinessSnapshotSchema`, and inferred readiness types.
- Consumes: workflow version constants, revision schema, and offset timestamp schema.

- [x] **Step 1: Write failing readiness tests**

Add literal readiness fixtures that prove:

- each item has a stable key, evaluator version, severity, result, reason code, user message, repair route and evidence time;
- a ready snapshot accepts passing and not-applicable items;
- a ready snapshot rejects any unresolved blocker;
- ready and live snapshots include every required Go Live blocker at blocker severity;
- `offline_disabled` exists as a blocker contract and has no mechanism to authorise offline attendance;
- unsupported evaluator versions and unknown fields are rejected.

- [x] **Step 2: Run focused tests to verify RED**

Run: `npm test -- tests/onboarding-contracts.test.ts`

Expected: FAIL because readiness exports are missing.

- [x] **Step 3: Implement readiness schemas**

The item result enum is `pass`, `needs_attention`, `blocked`, or `not_applicable`. Severity is `blocker`, `warning`, or `optional`. The snapshot overall status is `not_started`, `in_progress`, `needs_attention`, `ready`, or `live`. Schema refinements prevent required blocker downgrades and prevent both `ready` and `live` when any required blocker is missing or unresolved.

- [x] **Step 4: Run focused tests to verify GREEN**

Run: `npm test -- tests/onboarding-contracts.test.ts`

Expected: every contract test passes.

### Task 4: Regression and scope verification

**Files:**
- Modify only if verification exposes a contract-scoped defect.

**Interfaces:**
- Consumes: all Workstream 7 contract exports.
- Produces: a verified contract-only milestone with no later-phase implementation.

- [x] **Step 1: Run focused and neighbouring contract tests**

Run:

```powershell
npm test -- tests/onboarding-contracts.test.ts tests/offline-kiosk-sync-contract.test.ts tests/migration-history.test.ts
```

Expected: all pass and the migration total remains unchanged.

- [x] **Step 2: Run static and full regression checks**

Run:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run audit:dependencies
npm run verify:browser-bundle
```

Expected: zero errors, all tests pass, build succeeds, no high dependency advisory, and no sensitive server marker in the browser bundle.

- [x] **Step 3: Run repository safety checks**

Confirm branch, clean scope, no environment/configuration changes, no new migration, no production project reference, no former demo identity value in the current tree, and no secret with Gitleaks.

- [x] **Step 4: Review the final diff against the task boundary**

The diff may contain only the focused plan, onboarding contract module and contract tests. It must not contain onboarding persistence, tenancy changes, billing, attendance changes, kiosk/offline changes, environment configuration, deployment configuration, or production data.
