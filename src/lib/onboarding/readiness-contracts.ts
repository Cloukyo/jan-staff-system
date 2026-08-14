import { z } from "zod";

export const COMMERCIAL_READINESS_EVALUATOR_VERSION = 2 as const;

export const commercialReadinessCategorySchema = z.enum([
  "account",
  "organisation",
  "site",
  "plan",
  "staff",
  "managers",
  "staff_accounts",
  "clocking_device",
  "attendance",
]);

export const commercialReadinessKeySchema = z.enum([
  "owner_security",
  "legal_acceptance",
  "organisation_active",
  "organisation_settings",
  "ownership_state",
  "first_site",
  "site_settings",
  "site_operating_configuration",
  "subscription_pending",
  "entitlements_materialised",
  "staff_present",
  "staff_site_assignment",
  "attendance_eligible_staff",
  "manager_coverage",
  "staff_account_linkage",
  "online_kiosk",
  "kiosk_heartbeat",
  "kiosk_roster",
  "pin_ready_staff",
  "attendance_safety",
  "pre_live_evidence",
  "offline_disabled",
  "initial_rota",
  "compliance_follow_up",
]);

export const commercialReadinessStatusSchema = z.enum([
  "ready",
  "incomplete",
  "blocked",
  "warning",
  "not_applicable",
]);

export const commercialReadinessItemSchema = z
  .object({
    key: commercialReadinessKeySchema,
    category: commercialReadinessCategorySchema,
    status: commercialReadinessStatusSchema,
    severity: z.enum(["blocker", "warning", "optional"]),
    title: z.string().trim().min(2).max(120),
    explanation: z.string().trim().min(2).max(300),
    remediationRoute: z.string().regex(/^\/[a-z0-9/_-]*$/).max(240).nullable(),
    evidenceRevision: z.string().regex(/^[a-z0-9][a-z0-9_.:-]{0,191}$/),
  })
  .strict();

export const commercialReadinessSnapshotSchema = z
  .object({
    evaluatorVersion: z.literal(COMMERCIAL_READINESS_EVALUATOR_VERSION),
    sessionId: z.uuid(),
    organisationId: z.uuid(),
    workflowRevision: z.string().regex(/^(0|[1-9]\d*)$/),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    overallStatus: z.enum(["blocked", "ready", "live", "degraded"]),
    blockerCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative(),
    progressPercent: z.number().int().min(0).max(100),
    evaluatedAt: z.iso.datetime({ offset: true }),
    items: z.array(commercialReadinessItemSchema).min(1).max(40),
  })
  .strict()
  .superRefine((snapshot, context) => {
    const blockers = snapshot.items.filter(
      (item) => item.severity === "blocker" && item.status !== "ready",
    ).length;
    const warnings = snapshot.items.filter(
      (item) => item.severity === "warning" && item.status === "warning",
    ).length;
    if (snapshot.blockerCount !== blockers)
      context.addIssue({ code: "custom", message: "Blocker count does not match readiness items", path: ["blockerCount"] });
    if (snapshot.warningCount !== warnings)
      context.addIssue({ code: "custom", message: "Warning count does not match readiness items", path: ["warningCount"] });
    if (snapshot.overallStatus === "ready" && blockers > 0)
      context.addIssue({ code: "custom", message: "Ready state cannot contain blockers", path: ["overallStatus"] });
  });

export const goLivePayloadSchema = z
  .object({
    readinessFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    acknowledgedWarnings: z.array(z.literal("sole_manager")).max(1),
  })
  .strict();

export const commercialLiveSummarySchema = z
  .object({
    organisationId: z.uuid(),
    organisationName: z.string().trim().min(1).max(160),
    siteId: z.uuid(),
    siteName: z.string().trim().min(1).max(160),
    subscriptionId: z.uuid(),
    subscriptionState: z.literal("trial_active"),
    trialStartedAt: z.iso.datetime({ offset: true }),
    trialEndsAt: z.iso.datetime({ offset: true }),
    staffCount: z.number().int().positive(),
    kioskConnected: z.boolean(),
    offlineEnabled: z.literal(false),
  })
  .strict();

export type CommercialReadinessSnapshot = z.infer<typeof commercialReadinessSnapshotSchema>;
export type CommercialLiveSummary = z.infer<typeof commercialLiveSummarySchema>;
