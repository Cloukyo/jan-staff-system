import { z } from "zod";
import {
  manualStaffDraftPayloadSchema,
  manualStaffPayloadSchema,
  staffImportCommitPayloadSchema,
  staffImportDecisionPayloadSchema,
  staffImportUploadPayloadSchema,
  staffingSkipPayloadSchema,
  staffingSnapshotSchema,
} from "./staffing-contracts";
import {
  invitationReferencePayloadSchema,
  managerInvitationPayloadSchema,
  managerInvitationSnapshotSchema,
  soleManagerAcknowledgementPayloadSchema,
} from "./manager-invitation-contracts";
import {
  staffInvitationReferencePayloadSchema,
  staffInvitationSelectionPayloadSchema,
  staffInvitationSkipPayloadSchema,
  staffInvitationSnapshotSchema,
} from "./staff-invitation-contracts";

export const ONBOARDING_CONTRACT_SCHEMA_VERSION = 1 as const;
export const COMMERCIAL_CUSTOMER_WORKFLOW_KEY =
  "commercial_customer_v1" as const;
export const COMMERCIAL_CUSTOMER_WORKFLOW_VERSION = 1 as const;
export const ONBOARDING_READINESS_EVALUATOR_VERSION = 1 as const;

type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const timestampSchema = z.iso.datetime({ offset: true });
const revisionSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/, "Revision must be a non-negative decimal string");

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const sensitiveDraftKey =
  /password|mfa.?secret|(?:^|raw).*token|activation.?secret|^pin$|staff.?pin|payment.?details|card.?number|card.?cvc|raw.?(?:csv|import).*row/i;

function findSensitiveDraftPath(
  value: JsonValue,
  path: string[] = [],
): string[] | null {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findSensitiveDraftPath(item, [...path, String(index)]);
      if (found) return found;
    }
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  for (const [key, item] of Object.entries(value)) {
    if (sensitiveDraftKey.test(key)) return [...path, key];
    const found = findSensitiveDraftPath(item, [...path, key]);
    if (found) return found;
  }
  return null;
}

const draftPayloadSchema = z
  .record(z.string(), jsonValueSchema)
  .superRefine((value, context) => {
    const sensitivePath = findSensitiveDraftPath(value);
    if (sensitivePath) {
      context.addIssue({
        code: "custom",
        message:
          "Sensitive or secret fields are not allowed in onboarding drafts",
        path: sensitivePath,
      });
    }
  });

export const onboardingStepKeySchema = z.enum([
  "owner_account",
  "organisation",
  "first_site",
  "subscription",
  "settings",
  "staff",
  "manager_invitations",
  "staff_invitations",
  "kiosk",
  "initial_rota",
  "readiness",
  "go_live",
]);

export const onboardingBootstrapStepKeySchema = z.enum([
  "owner_security",
  "legal_acceptance",
  "organisation",
  "first_site",
  "subscription",
  "staffing",
  "manager_invitations",
  "staff_invitations",
]);

export const legalDocumentTypeSchema = z.enum([
  "terms_of_service",
  "privacy_acknowledgement",
  "data_processing_agreement",
]);

const onboardingStepDefinitionSchema = z
  .object({
    stepKey: onboardingStepKeySchema,
    stepVersion: z.literal(1),
    order: z.number().int().nonnegative(),
    prerequisiteStepKeys: z.array(onboardingStepKeySchema),
    progressWeight: z.number().int().min(0).max(100),
    optional: z.boolean(),
  })
  .strict();

const commercialCustomerWorkflowV1Steps = [
  {
    stepKey: "owner_account",
    stepVersion: 1,
    order: 0,
    prerequisiteStepKeys: [],
    progressWeight: 10,
    optional: false,
  },
  {
    stepKey: "organisation",
    stepVersion: 1,
    order: 1,
    prerequisiteStepKeys: ["owner_account"],
    progressWeight: 10,
    optional: false,
  },
  {
    stepKey: "first_site",
    stepVersion: 1,
    order: 2,
    prerequisiteStepKeys: ["organisation"],
    progressWeight: 10,
    optional: false,
  },
  {
    stepKey: "subscription",
    stepVersion: 1,
    order: 3,
    prerequisiteStepKeys: ["first_site"],
    progressWeight: 10,
    optional: false,
  },
  {
    stepKey: "settings",
    stepVersion: 1,
    order: 4,
    prerequisiteStepKeys: ["first_site"],
    progressWeight: 10,
    optional: false,
  },
  {
    stepKey: "staff",
    stepVersion: 1,
    order: 5,
    prerequisiteStepKeys: ["settings"],
    progressWeight: 15,
    optional: false,
  },
  {
    stepKey: "manager_invitations",
    stepVersion: 1,
    order: 6,
    prerequisiteStepKeys: ["staff"],
    progressWeight: 10,
    optional: false,
  },
  {
    stepKey: "staff_invitations",
    stepVersion: 1,
    order: 7,
    prerequisiteStepKeys: ["staff"],
    progressWeight: 5,
    optional: false,
  },
  {
    stepKey: "kiosk",
    stepVersion: 1,
    order: 8,
    prerequisiteStepKeys: ["first_site", "staff", "settings"],
    progressWeight: 15,
    optional: false,
  },
  {
    stepKey: "initial_rota",
    stepVersion: 1,
    order: 9,
    prerequisiteStepKeys: ["staff"],
    progressWeight: 0,
    optional: true,
  },
  {
    stepKey: "readiness",
    stepVersion: 1,
    order: 10,
    prerequisiteStepKeys: [
      "subscription",
      "settings",
      "staff",
      "manager_invitations",
      "staff_invitations",
      "kiosk",
    ],
    progressWeight: 5,
    optional: false,
  },
  {
    stepKey: "go_live",
    stepVersion: 1,
    order: 11,
    prerequisiteStepKeys: ["readiness"],
    progressWeight: 0,
    optional: false,
  },
] as const;

export const onboardingWorkflowDefinitionSchema = z
  .object({
    schemaVersion: z.literal(ONBOARDING_CONTRACT_SCHEMA_VERSION),
    workflowKey: z.literal(COMMERCIAL_CUSTOMER_WORKFLOW_KEY),
    workflowVersion: z.literal(COMMERCIAL_CUSTOMER_WORKFLOW_VERSION),
    readinessEvaluatorVersion: z.literal(
      ONBOARDING_READINESS_EVALUATOR_VERSION,
    ),
    steps: z.array(onboardingStepDefinitionSchema).min(1),
  })
  .strict()
  .superRefine((workflow, context) => {
    const seenKeys = new Set<string>();
    const seenOrders = new Set<number>();

    for (const [index, step] of workflow.steps.entries()) {
      if (seenKeys.has(step.stepKey)) {
        context.addIssue({
          code: "custom",
          message: "Workflow step keys must be unique",
          path: ["steps", index, "stepKey"],
        });
      }
      if (seenOrders.has(step.order)) {
        context.addIssue({
          code: "custom",
          message: "Workflow step order values must be unique",
          path: ["steps", index, "order"],
        });
      }
      for (const prerequisite of step.prerequisiteStepKeys) {
        if (prerequisite === step.stepKey) {
          context.addIssue({
            code: "custom",
            message: "A workflow step cannot be its own prerequisite",
            path: ["steps", index, "prerequisiteStepKeys"],
          });
        } else if (!seenKeys.has(prerequisite)) {
          context.addIssue({
            code: "custom",
            message: "Workflow prerequisites must refer to an earlier step",
            path: ["steps", index, "prerequisiteStepKeys"],
          });
        }
      }
      seenKeys.add(step.stepKey);
      seenOrders.add(step.order);
    }

    const totalWeight = workflow.steps.reduce(
      (total, step) => total + step.progressWeight,
      0,
    );
    if (totalWeight !== 100) {
      context.addIssue({
        code: "custom",
        message: "Workflow progress weights must total 100",
        path: ["steps"],
      });
    }

    if (
      JSON.stringify(workflow.steps) !==
      JSON.stringify(commercialCustomerWorkflowV1Steps)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Workflow steps must match the exact versioned commercial_customer_v1 definition",
        path: ["steps"],
      });
    }
  });

export const commercialCustomerWorkflowV1 =
  onboardingWorkflowDefinitionSchema.parse({
    schemaVersion: 1,
    workflowKey: "commercial_customer_v1",
    workflowVersion: 1,
    readinessEvaluatorVersion: 1,
    steps: commercialCustomerWorkflowV1Steps,
  });

export const onboardingWorkflowStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "needs_attention",
  "ready",
  "live",
  "abandoned",
]);

export const onboardingWorkflowStateSchema = z
  .object({
    schemaVersion: z.literal(ONBOARDING_CONTRACT_SCHEMA_VERSION),
    workflowKey: z.literal(COMMERCIAL_CUSTOMER_WORKFLOW_KEY),
    workflowVersion: z.literal(COMMERCIAL_CUSTOMER_WORKFLOW_VERSION),
    sessionId: z.uuid(),
    organisationId: z.uuid().nullable(),
    status: onboardingWorkflowStatusSchema,
    currentStepKey: onboardingStepKeySchema,
    revision: revisionSchema,
    startedAt: timestampSchema,
    lastActivityAt: timestampSchema,
    readyAt: timestampSchema.nullable(),
    goLiveAt: timestampSchema.nullable(),
    completedByMembershipId: z.uuid().nullable(),
  })
  .strict()
  .superRefine((state, context) => {
    if (state.status === "live" && state.goLiveAt === null) {
      context.addIssue({
        code: "custom",
        message: "Live workflow state requires Go Live evidence",
        path: ["goLiveAt"],
      });
    }
    if (state.goLiveAt !== null && state.status !== "live") {
      context.addIssue({
        code: "custom",
        message: "Go Live evidence requires historical live status",
        path: ["status"],
      });
    }
  });

export const onboardingStepStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "blocked",
  "complete",
  "skipped",
  "needs_review",
]);

const validationIssueSchema = z
  .object({
    code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    message: z.string().trim().min(1).max(240),
    fieldPath: z.array(z.string().trim().min(1).max(80)).max(12),
  })
  .strict();

export const onboardingStepStateSchema = z
  .object({
    schemaVersion: z.literal(ONBOARDING_CONTRACT_SCHEMA_VERSION),
    workflowKey: z.literal(COMMERCIAL_CUSTOMER_WORKFLOW_KEY),
    workflowVersion: z.literal(COMMERCIAL_CUSTOMER_WORKFLOW_VERSION),
    sessionId: z.uuid(),
    stepKey: onboardingStepKeySchema,
    stepVersion: z.literal(1),
    status: onboardingStepStatusSchema,
    revision: revisionSchema,
    draftPayload: draftPayloadSchema,
    validationSummary: z.array(validationIssueSchema).max(100),
    startedAt: timestampSchema.nullable(),
    completedAt: timestampSchema.nullable(),
    lastSavedAt: timestampSchema.nullable(),
    completedByAuthUserId: z.uuid().nullable(),
  })
  .strict();

export const onboardingCommandTypeSchema = z.enum([
  "save_step_draft",
  "accept_legal_documents",
  "complete_owner_setup",
  "create_organisation",
  "create_first_site",
  "select_plan",
  "save_settings",
  "save_staff_draft",
  "create_staff",
  "preview_staff_import",
  "review_staff_import_row",
  "commit_staff_import",
  "complete_staffing",
  "skip_staffing",
  "create_manager_invitation",
  "resend_manager_invitation",
  "revoke_manager_invitation",
  "acknowledge_sole_manager",
  "complete_manager_invitation_step",
  "create_staff_invitations",
  "resend_staff_invitation",
  "revoke_staff_invitation",
  "skip_staff_invitation_step",
  "complete_staff_invitation_step",
  "start_kiosk_registration",
  "confirm_kiosk_connection",
  "evaluate_readiness",
  "go_live",
]);

const legalAcceptanceCommandPayloadSchema = z
  .object({
    acceptances: z
      .array(
        z
          .object({
            documentType: legalDocumentTypeSchema,
            documentVersion: z.string().trim().min(1).max(64),
            locale: z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/),
          })
          .strict(),
      )
      .length(3),
    safeRequestMetadata: z
      .object({
        source: z.literal("commercial_onboarding"),
      })
      .strict(),
  })
  .strict();

export const organisationCreationPayloadSchema = z
  .object({
    displayName: z.string().trim().min(2).max(160),
    legalName: z.string().trim().min(2).max(200),
    contactEmail: z.email().transform((value) => value.toLowerCase()),
    country: z.string().regex(/^[A-Z]{2}$/),
    timezone: z.string().trim().min(1).max(80),
    postalAddress: z
      .object({
        line1: z.string().trim().min(2).max(160),
        line2: z.string().trim().max(160).optional(),
        locality: z.string().trim().min(2).max(120),
        region: z.string().trim().max(120).optional(),
        postcode: z.string().trim().min(2).max(24),
      })
      .strict(),
    phone: z.string().trim().min(5).max(40).optional(),
  })
  .strict();

const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time in HH:mm format");

const siteOpeningIntervalSchema = z
  .object({
    opensAt: localTimeSchema,
    closesAt: localTimeSchema,
  })
  .strict()
  .superRefine((interval, context) => {
    if (interval.opensAt >= interval.closesAt) {
      context.addIssue({
        code: "custom",
        message: "Opening time must be before closing time",
        path: ["closesAt"],
      });
    }
  });

const siteOpeningDaySchema = z
  .object({
    dayOfWeek: z.number().int().min(1).max(7),
    intervals: z.array(siteOpeningIntervalSchema).max(4),
  })
  .strict()
  .superRefine((day, context) => {
    const sorted = [...day.intervals].sort((left, right) =>
      left.opensAt.localeCompare(right.opensAt),
    );
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index - 1].closesAt > sorted[index].opensAt) {
        context.addIssue({
          code: "custom",
          message: "Opening intervals cannot overlap",
          path: ["intervals"],
        });
        return;
      }
    }
  });

export const firstSitePayloadSchema = z
  .object({
    siteName: z.string().trim().min(2).max(160),
    displayName: z.string().trim().min(2).max(160).optional(),
    contactPhone: z.string().trim().min(5).max(40),
    siteEmail: z
      .email()
      .transform((value) => value.toLowerCase())
      .optional(),
    country: z.literal("GB"),
    timezone: z.literal("Europe/London"),
    postalAddress: z
      .object({
        line1: z.string().trim().min(2).max(160),
        line2: z.string().trim().max(160).optional(),
        locality: z.string().trim().min(2).max(120),
        region: z.string().trim().max(120).optional(),
        postcode: z.string().trim().min(2).max(24),
      })
      .strict(),
    openingHours: z.array(siteOpeningDaySchema).length(7),
    workWeekStarts: z.number().int().min(1).max(7),
    operationalDayBoundary: localTimeSchema,
  })
  .strict()
  .superRefine((site, context) => {
    const days = new Set(site.openingHours.map((day) => day.dayOfWeek));
    if (days.size !== 7) {
      context.addIssue({
        code: "custom",
        message: "Opening hours must contain seven unique days",
        path: ["openingHours"],
      });
    }
    if (!site.openingHours.some((day) => day.intervals.length > 0)) {
      context.addIssue({
        code: "custom",
        message: "At least one opening interval is required",
        path: ["openingHours"],
      });
    }
    if (site.operationalDayBoundary > "06:00") {
      context.addIssue({
        code: "custom",
        message: "Operational day boundary must be between 00:00 and 06:00",
        path: ["operationalDayBoundary"],
      });
    }
  });

export const firstSiteDraftPayloadSchema = z
  .object({
    stepKey: z.literal("first_site"),
    draft: z
      .object({
        siteName: z.string().trim().max(160).optional(),
        displayName: z.string().trim().max(160).optional(),
        contactPhone: z.string().trim().max(40).optional(),
        siteEmail: z.string().trim().max(254).optional(),
        country: z.literal("GB").optional(),
        timezone: z.literal("Europe/London").optional(),
        postalAddress: z
          .object({
            line1: z.string().trim().max(160).optional(),
            line2: z.string().trim().max(160).optional(),
            locality: z.string().trim().max(120).optional(),
            region: z.string().trim().max(120).optional(),
            postcode: z.string().trim().max(24).optional(),
          })
          .strict()
          .optional(),
        openingHours: z
          .array(
            z
              .object({
                dayOfWeek: z.number().int().min(1).max(7),
                intervals: z
                  .array(
                    z
                      .object({
                        opensAt: z.string().max(5),
                        closesAt: z.string().max(5),
                      })
                      .strict(),
                  )
                  .max(4),
              })
              .strict(),
          )
          .max(7)
          .optional(),
        workWeekStarts: z.number().int().min(1).max(7).optional(),
        operationalDayBoundary: localTimeSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const planSelectionPayloadSchema = z
  .object({
    planKey: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
    planVersion: z.number().int().positive(),
    selection: z.literal("free_trial"),
  })
  .strict();

export const commercialPlanCatalogueEntrySchema = z
  .object({
    planKey: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
    planVersion: z.number().int().positive(),
    displayName: z.string().trim().min(2).max(120),
    summary: z.string().trim().min(2).max(500),
    trialDurationDays: z.literal(60),
    pricingStatus: z.literal("preview_unpriced"),
    featureHighlights: z.array(z.string().trim().min(2).max(120)).min(1).max(8),
  })
  .strict();

export const organisationSubscriptionSummarySchema = z
  .object({
    subscriptionId: z.uuid(),
    planKey: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
    planVersion: z.number().int().positive(),
    planDisplayName: z.string().trim().min(2).max(120),
    state: z.literal("trial_pending"),
    trialDurationDays: z.literal(60),
    trialStartedAt: z.null(),
    trialEndsAt: z.null(),
  })
  .strict();

export const onboardingCommandSchema = z
  .object({
    schemaVersion: z.literal(ONBOARDING_CONTRACT_SCHEMA_VERSION),
    workflowKey: z.literal(COMMERCIAL_CUSTOMER_WORKFLOW_KEY),
    workflowVersion: z.literal(COMMERCIAL_CUSTOMER_WORKFLOW_VERSION),
    sessionId: z.uuid(),
    commandType: onboardingCommandTypeSchema,
    idempotencyKey: z.uuid(),
    expectedSessionRevision: revisionSchema,
    payload: z.record(z.string(), jsonValueSchema),
  })
  .strict();

export const onboardingBootstrapCommandSchema = onboardingCommandSchema
  .superRefine((command, context) => {
    if (command.commandType === "accept_legal_documents") {
      const result = legalAcceptanceCommandPayloadSchema.safeParse(
        command.payload,
      );
      if (!result.success) {
        for (const issue of result.error.issues) {
          context.addIssue({ ...issue, path: ["payload", ...issue.path] });
        }
      }
    }
    if (command.commandType === "create_organisation") {
      const result = organisationCreationPayloadSchema.safeParse(
        command.payload,
      );
      if (!result.success) {
        for (const issue of result.error.issues) {
          context.addIssue({ ...issue, path: ["payload", ...issue.path] });
        }
      }
    }
    if (command.commandType === "create_first_site") {
      const result = firstSitePayloadSchema.safeParse(command.payload);
      if (!result.success) {
        for (const issue of result.error.issues) {
          context.addIssue({ ...issue, path: ["payload", ...issue.path] });
        }
      }
    }
    if (command.commandType === "select_plan") {
      const result = planSelectionPayloadSchema.safeParse(command.payload);
      if (!result.success) {
        for (const issue of result.error.issues) {
          context.addIssue({ ...issue, path: ["payload", ...issue.path] });
        }
      }
    }
    const staffingSchema =
      command.commandType === "save_staff_draft"
        ? manualStaffDraftPayloadSchema
        : command.commandType === "create_staff"
          ? manualStaffPayloadSchema
          : command.commandType === "preview_staff_import"
            ? staffImportUploadPayloadSchema
            : command.commandType === "review_staff_import_row"
              ? staffImportDecisionPayloadSchema
              : command.commandType === "commit_staff_import"
                ? staffImportCommitPayloadSchema
                : command.commandType === "skip_staffing"
                  ? staffingSkipPayloadSchema
                  : null;
    if (staffingSchema) {
      const result = staffingSchema.safeParse(command.payload);
      if (!result.success)
        for (const issue of result.error.issues)
          context.addIssue({ ...issue, path: ["payload", ...issue.path] });
    }
    if (
      command.commandType === "complete_staffing" &&
      Object.keys(command.payload).length !== 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Complete staffing accepts no payload",
        path: ["payload"],
      });
    }
    const managerSchema =
      command.commandType === "create_manager_invitation"
        ? managerInvitationPayloadSchema
        : command.commandType === "resend_manager_invitation" ||
            command.commandType === "revoke_manager_invitation"
          ? invitationReferencePayloadSchema
          : command.commandType === "acknowledge_sole_manager"
            ? soleManagerAcknowledgementPayloadSchema
            : null;
    if (managerSchema) {
      const result = managerSchema.safeParse(command.payload);
      if (!result.success)
        for (const issue of result.error.issues)
          context.addIssue({ ...issue, path: ["payload", ...issue.path] });
    }
    if (
      command.commandType === "complete_manager_invitation_step" &&
      Object.keys(command.payload).length !== 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Complete manager invitations accepts no payload",
        path: ["payload"],
      });
    }
    const staffInvitationSchema =
      command.commandType === "create_staff_invitations"
        ? staffInvitationSelectionPayloadSchema
        : command.commandType === "resend_staff_invitation" ||
            command.commandType === "revoke_staff_invitation"
          ? staffInvitationReferencePayloadSchema
          : command.commandType === "skip_staff_invitation_step"
            ? staffInvitationSkipPayloadSchema
            : null;
    if (staffInvitationSchema) {
      const result = staffInvitationSchema.safeParse(command.payload);
      if (!result.success)
        for (const issue of result.error.issues)
          context.addIssue({ ...issue, path: ["payload", ...issue.path] });
    }
    if (
      command.commandType === "complete_staff_invitation_step" &&
      Object.keys(command.payload).length !== 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Complete staff invitations accepts no payload",
        path: ["payload"],
      });
    }
    if (command.commandType === "save_step_draft") {
      const result = firstSiteDraftPayloadSchema.safeParse(command.payload);
      if (!result.success) {
        for (const issue of result.error.issues) {
          context.addIssue({ ...issue, path: ["payload", ...issue.path] });
        }
      }
    }
  })
  .transform((command) => {
    if (command.commandType === "accept_legal_documents") {
      return {
        ...command,
        payload: legalAcceptanceCommandPayloadSchema.parse(command.payload),
      };
    }
    if (command.commandType === "create_organisation") {
      return {
        ...command,
        payload: organisationCreationPayloadSchema.parse(command.payload),
      };
    }
    if (command.commandType === "create_first_site") {
      return {
        ...command,
        payload: firstSitePayloadSchema.parse(command.payload),
      };
    }
    if (command.commandType === "select_plan") {
      return {
        ...command,
        payload: planSelectionPayloadSchema.parse(command.payload),
      };
    }
    if (command.commandType === "save_staff_draft")
      return {
        ...command,
        payload: manualStaffDraftPayloadSchema.parse(command.payload),
      };
    if (command.commandType === "create_staff")
      return {
        ...command,
        payload: manualStaffPayloadSchema.parse(command.payload),
      };
    if (command.commandType === "create_manager_invitation")
      return {
        ...command,
        payload: managerInvitationPayloadSchema.parse(command.payload),
      };
    if (
      command.commandType === "resend_manager_invitation" ||
      command.commandType === "revoke_manager_invitation"
    )
      return {
        ...command,
        payload: invitationReferencePayloadSchema.parse(command.payload),
      };
    if (command.commandType === "acknowledge_sole_manager")
      return {
        ...command,
        payload: soleManagerAcknowledgementPayloadSchema.parse(command.payload),
      };
    if (command.commandType === "create_staff_invitations")
      return {
        ...command,
        payload: staffInvitationSelectionPayloadSchema.parse(command.payload),
      };
    if (
      command.commandType === "resend_staff_invitation" ||
      command.commandType === "revoke_staff_invitation"
    )
      return {
        ...command,
        payload: staffInvitationReferencePayloadSchema.parse(command.payload),
      };
    if (command.commandType === "skip_staff_invitation_step")
      return {
        ...command,
        payload: staffInvitationSkipPayloadSchema.parse(command.payload),
      };
    if (command.commandType === "preview_staff_import")
      return {
        ...command,
        payload: staffImportUploadPayloadSchema.parse(command.payload),
      };
    if (command.commandType === "review_staff_import_row")
      return {
        ...command,
        payload: staffImportDecisionPayloadSchema.parse(command.payload),
      };
    if (command.commandType === "commit_staff_import")
      return {
        ...command,
        payload: staffImportCommitPayloadSchema.parse(command.payload),
      };
    if (command.commandType === "skip_staffing")
      return {
        ...command,
        payload: staffingSkipPayloadSchema.parse(command.payload),
      };
    if (command.commandType === "save_step_draft") {
      return {
        ...command,
        payload: firstSiteDraftPayloadSchema.parse(command.payload),
      };
    }
    return command;
  });

const stableCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,95}$/);
const internalRepairRouteSchema = z
  .string()
  .regex(/^\/[a-z0-9/_-]*$/)
  .max(240);

const commandIssueSchema = z
  .object({
    code: stableCodeSchema,
    message: z.string().trim().min(1).max(240),
    fieldPath: z.array(z.string().trim().min(1).max(80)).max(12),
    repairRoute: internalRepairRouteSchema.nullable(),
  })
  .strict();

const safeResultReferenceSchema = z
  .object({
    organisationId: z.uuid().optional(),
    siteId: z.uuid().optional(),
    staffId: stableCodeSchema.optional(),
    staffIds: z.array(stableCodeSchema).max(1_000).optional(),
    importBatchId: z.uuid().optional(),
    invitationIds: z.array(z.uuid()).max(1_000).optional(),
    kioskRegistrationId: z.uuid().optional(),
    kioskDeviceId: z.uuid().optional(),
    readinessSnapshotId: z.uuid().optional(),
    legalAcceptanceId: z.uuid().optional(),
    subscriptionId: z.uuid().optional(),
  })
  .strict();

const safeEventMetadataSchema = z
  .object({
    statusCode: stableCodeSchema.optional(),
    planKey: stableCodeSchema.optional(),
    featureKey: stableCodeSchema.optional(),
    capabilityKey: stableCodeSchema.optional(),
    durationBucket: stableCodeSchema.optional(),
    failureCategory: stableCodeSchema.optional(),
    deliveryStatus: stableCodeSchema.optional(),
    activationStatus: stableCodeSchema.optional(),
    warningCodes: z.array(stableCodeSchema).max(100).optional(),
    resultCodes: z.array(stableCodeSchema).max(100).optional(),
    resourceCounts: z
      .record(stableCodeSchema, z.number().int().nonnegative())
      .optional(),
    attemptCount: z.number().int().nonnegative().optional(),
    retryCount: z.number().int().nonnegative().optional(),
    resourceId: z.uuid().optional(),
    resourceIds: z.array(z.uuid()).max(1_000).optional(),
    wasReplayed: z.boolean().optional(),
    isRetryable: z.boolean().optional(),
  })
  .strict();

export const onboardingCommandOutcomeSchema = z.enum([
  "succeeded",
  "replayed",
  "validation_failed",
  "workflow_changed",
  "permission_denied",
  "capability_denied",
  "retryable_failure",
  "indeterminate",
]);

export const onboardingCommandDataStateSchema = z.enum([
  "saved",
  "not_saved",
  "unknown",
]);

export const onboardingCommandResultSchema = z
  .object({
    schemaVersion: z.literal(ONBOARDING_CONTRACT_SCHEMA_VERSION),
    workflowKey: z.literal(COMMERCIAL_CUSTOMER_WORKFLOW_KEY),
    workflowVersion: z.literal(COMMERCIAL_CUSTOMER_WORKFLOW_VERSION),
    sessionId: z.uuid(),
    commandType: onboardingCommandTypeSchema,
    outcome: onboardingCommandOutcomeSchema,
    dataState: onboardingCommandDataStateSchema,
    resultCode: stableCodeSchema,
    resultReference: safeResultReferenceSchema,
    sessionRevision: revisionSchema,
    issues: z.array(commandIssueSchema).max(100),
  })
  .strict()
  .superRefine((result, context) => {
    const requiredDataState =
      result.outcome === "succeeded" || result.outcome === "replayed"
        ? "saved"
        : result.outcome === "indeterminate"
          ? "unknown"
          : "not_saved";
    if (result.dataState !== requiredDataState) {
      context.addIssue({
        code: "custom",
        message: `Command outcome ${result.outcome} must report data state ${requiredDataState}`,
        path: ["dataState"],
      });
    }
  });

export const onboardingEventTypeSchema = z.enum([
  "onboarding_started",
  "signup_started",
  "owner_email_verified",
  "owner_mfa_enrolled",
  "owner_mfa_ready",
  "legal_acceptance_completed",
  "organisation_creation_started",
  "organisation_created",
  "first_site_started",
  "first_site_validation_failed",
  "first_site_defaults_created",
  "first_site_created",
  "plan_selection_started",
  "plan_selected",
  "trial_selected",
  "trial_pending_created",
  "subscription_step_completed",
  "trial_activated",
  "settings_completed",
  "staff_import_started",
  "staffing_started",
  "staff_manual_created",
  "staff_import_uploaded",
  "staff_import_validated",
  "staff_import_reviewed",
  "staff_import_committed",
  "staffing_skipped",
  "staffing_completed",
  "manager_invitations_created",
  "staff_invitations_created",
  "kiosk_registration_started",
  "kiosk_connected",
  "readiness_evaluated",
  "go_live_blocked",
  "go_live_completed",
  "restricted_mode_entered",
  "subscription_recovered",
]);

export const onboardingEventActorTypeSchema = z.enum([
  "owner",
  "member",
  "system",
  "billing_provider",
  "support",
]);

export const onboardingEventSchema = z
  .object({
    schemaVersion: z.literal(ONBOARDING_CONTRACT_SCHEMA_VERSION),
    workflowKey: z.literal(COMMERCIAL_CUSTOMER_WORKFLOW_KEY),
    workflowVersion: z.literal(COMMERCIAL_CUSTOMER_WORKFLOW_VERSION),
    eventVersion: z.literal(1),
    id: z.uuid(),
    sessionId: z.uuid(),
    organisationId: z.uuid().nullable(),
    eventType: onboardingEventTypeSchema,
    stepKey: z
      .union([onboardingStepKeySchema, onboardingBootstrapStepKeySchema])
      .nullable(),
    actorType: onboardingEventActorTypeSchema,
    actorAuthUserId: z.uuid().nullable(),
    actorMembershipId: z.uuid().nullable(),
    requestId: z.uuid().nullable(),
    workflowRevision: revisionSchema,
    safeMetadata: safeEventMetadataSchema,
    occurredAt: timestampSchema,
  })
  .strict();

export const onboardingReadinessItemKeySchema = z.enum([
  "owner_identity",
  "legal_acceptance",
  "organisation",
  "owner_membership",
  "first_site",
  "operational_settings",
  "commercial_access",
  "attendance_policy",
  "pin_policy",
  "eligible_staff",
  "online_kiosk",
  "kiosk_roster",
  "offline_disabled",
  "security_health",
  "command_health",
  "manager_coverage",
  "staff_invitation_decision",
  "payroll_settings",
  "initial_rota",
]);

export const ONBOARDING_REQUIRED_READINESS_BLOCKERS = [
  "owner_identity",
  "legal_acceptance",
  "organisation",
  "owner_membership",
  "first_site",
  "operational_settings",
  "commercial_access",
  "attendance_policy",
  "pin_policy",
  "eligible_staff",
  "online_kiosk",
  "kiosk_roster",
  "offline_disabled",
  "security_health",
  "command_health",
] as const;

export const onboardingReadinessSeveritySchema = z.enum([
  "blocker",
  "warning",
  "optional",
]);

export const onboardingReadinessResultSchema = z.enum([
  "pass",
  "needs_attention",
  "blocked",
  "not_applicable",
]);

export const onboardingReadinessItemSchema = z
  .object({
    itemKey: onboardingReadinessItemKeySchema,
    evaluatorVersion: z.literal(ONBOARDING_READINESS_EVALUATOR_VERSION),
    severity: onboardingReadinessSeveritySchema,
    result: onboardingReadinessResultSchema,
    reasonCode: stableCodeSchema,
    userMessage: z.string().trim().min(1).max(240),
    repairRoute: internalRepairRouteSchema.nullable(),
    evidenceAt: timestampSchema,
    sourceRevision: z.string().regex(/^[a-z0-9][a-z0-9_.:-]{0,127}$/),
  })
  .strict()
  .superRefine((item, context) => {
    const isRequiredBlocker = ONBOARDING_REQUIRED_READINESS_BLOCKERS.some(
      (itemKey) => itemKey === item.itemKey,
    );
    if (isRequiredBlocker && item.severity !== "blocker") {
      context.addIssue({
        code: "custom",
        message: `Required readiness item ${item.itemKey} must retain blocker severity`,
        path: ["severity"],
      });
    }
  });

export const onboardingReadinessOverallStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "needs_attention",
  "ready",
  "live",
]);

export const onboardingReadinessSnapshotSchema = z
  .object({
    schemaVersion: z.literal(ONBOARDING_CONTRACT_SCHEMA_VERSION),
    workflowKey: z.literal(COMMERCIAL_CUSTOMER_WORKFLOW_KEY),
    workflowVersion: z.literal(COMMERCIAL_CUSTOMER_WORKFLOW_VERSION),
    evaluatorVersion: z.literal(ONBOARDING_READINESS_EVALUATOR_VERSION),
    sessionId: z.uuid(),
    organisationId: z.uuid().nullable(),
    overallStatus: onboardingReadinessOverallStatusSchema,
    workflowRevision: revisionSchema,
    items: z.array(onboardingReadinessItemSchema).min(1),
    evaluatedAt: timestampSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    const seenItems = new Set<string>();
    for (const [index, item] of snapshot.items.entries()) {
      if (seenItems.has(item.itemKey)) {
        context.addIssue({
          code: "custom",
          message: "Readiness item keys must be unique",
          path: ["items", index, "itemKey"],
        });
      }
      seenItems.add(item.itemKey);
    }

    if (
      snapshot.overallStatus === "ready" ||
      snapshot.overallStatus === "live"
    ) {
      const evaluatedItems = new Set(
        snapshot.items.map((item) => item.itemKey),
      );
      const missingBlocker = ONBOARDING_REQUIRED_READINESS_BLOCKERS.find(
        (itemKey) => !evaluatedItems.has(itemKey),
      );
      if (missingBlocker) {
        context.addIssue({
          code: "custom",
          message: `A ${snapshot.overallStatus} snapshot is missing required blocker ${missingBlocker}`,
          path: ["items"],
        });
      }

      const unresolvedBlockerIndex = snapshot.items.findIndex(
        (item) => item.severity === "blocker" && item.result !== "pass",
      );
      if (unresolvedBlockerIndex !== -1) {
        context.addIssue({
          code: "custom",
          message: `A ${snapshot.overallStatus} snapshot cannot contain an unresolved blocker`,
          path: ["items", unresolvedBlockerIndex, "result"],
        });
      }
    }
  });

export type OnboardingStepKey = z.infer<typeof onboardingStepKeySchema>;
export type OnboardingWorkflowDefinition = z.infer<
  typeof onboardingWorkflowDefinitionSchema
>;
export type OnboardingWorkflowState = z.infer<
  typeof onboardingWorkflowStateSchema
>;
export type OnboardingStepState = z.infer<typeof onboardingStepStateSchema>;
export type OnboardingCommand = z.infer<typeof onboardingCommandSchema>;
export type OnboardingCommandResult = z.infer<
  typeof onboardingCommandResultSchema
>;
export type OnboardingEvent = z.infer<typeof onboardingEventSchema>;
export type OnboardingReadinessItem = z.infer<
  typeof onboardingReadinessItemSchema
>;
export type OnboardingReadinessSnapshot = z.infer<
  typeof onboardingReadinessSnapshotSchema
>;

export const onboardingBootstrapSnapshotSchema = z
  .object({
    session: z
      .object({
        id: z.uuid(),
        organisationId: z.uuid().nullable(),
        workflowKey: z.literal(COMMERCIAL_CUSTOMER_WORKFLOW_KEY),
        workflowVersion: z.literal(COMMERCIAL_CUSTOMER_WORKFLOW_VERSION),
        status: onboardingWorkflowStatusSchema,
        currentStepKey: onboardingStepKeySchema,
        revision: revisionSchema,
        lastActivityAt: timestampSchema,
      })
      .strict(),
    security: z
      .object({
        emailVerified: z.boolean(),
        assuranceLevel: z.enum(["aal1", "aal2"]),
        legalAcceptancesCurrent: z.boolean(),
      })
      .strict(),
    steps: z
      .array(
        z
          .object({
            stepKey: onboardingBootstrapStepKeySchema,
            status: onboardingStepStatusSchema,
            revision: revisionSchema,
            draftPayload: draftPayloadSchema,
            validationSummary: z.array(validationIssueSchema),
          })
          .strict(),
      )
      .length(8),
    legalDocuments: z
      .array(
        z
          .object({
            documentType: legalDocumentTypeSchema,
            documentVersion: z.string().min(1).max(64),
            locale: z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/),
            title: z.string().min(2).max(120),
            summary: z.string().min(2).max(500),
            effectiveAt: timestampSchema,
            accepted: z.boolean(),
          })
          .strict(),
      )
      .length(3),
    siteSummary: z
      .object({
        siteId: z.uuid(),
        displayName: z.string().min(1).max(160),
        timezone: z.string().min(1).max(80),
      })
      .strict()
      .nullable(),
    planCatalogue: z.array(commercialPlanCatalogueEntrySchema).max(20),
    subscriptionSummary: organisationSubscriptionSummarySchema.nullable(),
    staffing: staffingSnapshotSchema,
    managerInvitations: managerInvitationSnapshotSchema,
    staffInvitations: staffInvitationSnapshotSchema,
  })
  .strict();

export type OnboardingBootstrapSnapshot = z.infer<
  typeof onboardingBootstrapSnapshotSchema
>;
