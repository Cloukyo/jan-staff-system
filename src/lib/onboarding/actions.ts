"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { requireCommercialIdentity } from "@/lib/commercial-identity/server";
import { requireAal2 } from "@/lib/commercial-identity/guards";
import { CommercialIdentityError } from "@/lib/commercial-identity/errors";
import { firstSitePayloadSchema, organisationCreationPayloadSchema } from "./contracts";
import {
  executeOnboardingBootstrapCommandServer,
  loadOnboardingBootstrapServer,
} from "./server";

export type OnboardingFormState = {
  ok: boolean;
  code: string;
  message: string;
  fieldErrors: Record<string, string>;
  values: Record<string, string>;
};

const initialOnboardingFormState: OnboardingFormState = {
  ok: false,
  code: "",
  message: "",
  fieldErrors: {},
  values: {},
};

function formValues(formData: FormData) {
  const keys = ["displayName", "legalName", "contactEmail", "country", "timezone", "line1", "line2", "locality", "region", "postcode", "phone"];
  return Object.fromEntries(keys.map((key) => [key, String(formData.get(key) ?? "")]));
}

const weekdayFields = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

function firstSiteFormValues(formData: FormData) {
  const keys = ["siteName", "displayName", "contactPhone", "siteEmail", "country", "timezone", "line1", "line2", "locality", "region", "postcode", "workWeekStarts", "operationalDayBoundary"];
  const values = Object.fromEntries(keys.map((key) => [key, String(formData.get(key) ?? "")]));
  for (const day of weekdayFields) {
    values[`${day}Open`] = String(formData.get(`${day}Open`) ?? "");
    values[`${day}Close`] = String(formData.get(`${day}Close`) ?? "");
    values[`${day}Closed`] = formData.get(`${day}Closed`) === "yes" ? "yes" : "";
  }
  return values;
}

function firstSitePayload(values: Record<string, string>) {
  return {
    siteName: values.siteName,
    ...(values.displayName ? { displayName: values.displayName } : {}),
    contactPhone: values.contactPhone,
    ...(values.siteEmail ? { siteEmail: values.siteEmail } : {}),
    country: values.country,
    timezone: values.timezone,
    postalAddress: {
      line1: values.line1,
      ...(values.line2 ? { line2: values.line2 } : {}),
      locality: values.locality,
      ...(values.region ? { region: values.region } : {}),
      postcode: values.postcode,
    },
    openingHours: weekdayFields.map((day, index) => ({
      dayOfWeek: index + 1,
      intervals: values[`${day}Closed`] === "yes" ? [] : [{ opensAt: values[`${day}Open`], closesAt: values[`${day}Close`] }],
    })),
    workWeekStarts: Number(values.workWeekStarts),
    operationalDayBoundary: values.operationalDayBoundary,
  };
}

export async function acceptLegalDocumentsAction(
  _state: OnboardingFormState,
  formData: FormData,
): Promise<OnboardingFormState> {
  const snapshot = await loadOnboardingBootstrapServer();
  const accepted = formData.get("accepted") === "yes";
  if (!accepted) {
    return { ...initialOnboardingFormState, code: "acceptance_required", message: "Confirm that you accept all three current documents before continuing." };
  }
  const submittedDocuments = formData.getAll("documentAcceptance").map((value) => {
    const [documentType, documentVersion, locale] = String(value).split("|");
    return { documentType, documentVersion, locale };
  });
  const response = await executeOnboardingBootstrapCommandServer({
    schemaVersion: 1,
    workflowKey: "commercial_customer_v1",
    workflowVersion: 1,
    sessionId: snapshot.session.id,
    commandType: "accept_legal_documents",
    idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
    expectedSessionRevision: String(formData.get("expectedSessionRevision") ?? ""),
    payload: {
      acceptances: submittedDocuments,
      safeRequestMetadata: { source: "commercial_onboarding" },
    },
  });
  if (response.commandResult.outcome === "succeeded" || response.commandResult.outcome === "replayed") {
    redirect("/onboarding/organisation");
  }
  return {
    ...initialOnboardingFormState,
    code: response.commandResult.resultCode,
    message: response.commandResult.issues[0]?.message ?? "Nothing was saved. Reload and try again.",
  };
}

export async function createOrganisationAction(
  _state: OnboardingFormState,
  formData: FormData,
): Promise<OnboardingFormState> {
  const values = formValues(formData);
  const parsed = organisationCreationPayloadSchema.safeParse({
    displayName: values.displayName,
    legalName: values.legalName,
    contactEmail: values.contactEmail,
    country: values.country,
    timezone: values.timezone,
    postalAddress: {
      line1: values.line1,
      ...(values.line2 ? { line2: values.line2 } : {}),
      locality: values.locality,
      ...(values.region ? { region: values.region } : {}),
      postcode: values.postcode,
    },
    ...(values.phone ? { phone: values.phone } : {}),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
    return { ok: false, code: "validation_failed", message: "Nothing was saved. Check the highlighted fields.", fieldErrors, values };
  }

  try {
    requireAal2(await requireCommercialIdentity());
  } catch (error) {
    if (error instanceof CommercialIdentityError && error.code === "mfa_required") {
      return { ok: false, code: "mfa_required", message: "Nothing was saved. Complete multi-factor authentication, then try again.", fieldErrors: {}, values };
    }
    throw error;
  }

  const snapshot = await loadOnboardingBootstrapServer();
  const response = await executeOnboardingBootstrapCommandServer({
    schemaVersion: 1,
    workflowKey: "commercial_customer_v1",
    workflowVersion: 1,
    sessionId: snapshot.session.id,
    commandType: "create_organisation",
    idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
    expectedSessionRevision: String(formData.get("expectedSessionRevision") ?? ""),
    payload: parsed.data,
  });
  if (response.commandResult.outcome === "succeeded" || response.commandResult.outcome === "replayed") {
    redirect("/onboarding/site");
  }
  return {
    ok: false,
    code: response.commandResult.resultCode,
    message: response.commandResult.issues[0]?.message ?? "Nothing was saved. Reload and try again.",
    fieldErrors: {},
    values,
  };
}

export async function createFirstSiteAction(
  _state: OnboardingFormState,
  formData: FormData,
): Promise<OnboardingFormState> {
  const values = firstSiteFormValues(formData);
  const intent = String(formData.get("intent") ?? "continue");
  const candidate = firstSitePayload(values);
  const snapshot = await loadOnboardingBootstrapServer();

  try {
    requireAal2(await requireCommercialIdentity());
  } catch (error) {
    if (error instanceof CommercialIdentityError && error.code === "mfa_required") {
      return { ok: false, code: "mfa_required", message: "Nothing was saved. Complete multi-factor authentication, then try again.", fieldErrors: {}, values };
    }
    throw error;
  }

  if (intent === "save_exit") {
    const response = await executeOnboardingBootstrapCommandServer({
      schemaVersion: 1, workflowKey: "commercial_customer_v1", workflowVersion: 1,
      sessionId: snapshot.session.id, commandType: "save_step_draft",
      idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
      expectedSessionRevision: String(formData.get("expectedSessionRevision") ?? ""),
      payload: { stepKey: "first_site", draft: candidate },
    });
    if (response.commandResult.outcome === "succeeded" || response.commandResult.outcome === "replayed") {
      await (await createSupabaseServerClient()).auth.signOut();
      redirect("/login?onboarding=saved");
    }
    return { ok: false, code: response.commandResult.resultCode,
      message: response.commandResult.issues[0]?.message ?? "Nothing was saved. Reload and try again.", fieldErrors: {}, values };
  }

  const parsed = firstSitePayloadSchema.safeParse(candidate);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
    return { ok: false, code: "validation_failed", message: "Nothing was saved. Check the highlighted fields.", fieldErrors, values };
  }
  const response = await executeOnboardingBootstrapCommandServer({
    schemaVersion: 1, workflowKey: "commercial_customer_v1", workflowVersion: 1,
    sessionId: snapshot.session.id, commandType: "create_first_site",
    idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
    expectedSessionRevision: String(formData.get("expectedSessionRevision") ?? ""), payload: parsed.data,
  });
  if (response.commandResult.outcome === "succeeded" || response.commandResult.outcome === "replayed") redirect("/onboarding/next");
  return { ok: false, code: response.commandResult.resultCode,
    message: response.commandResult.issues[0]?.message ?? "Nothing was saved. Reload and try again.", fieldErrors: {}, values };
}

export async function resendVerificationAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (data.user?.email) {
    await supabase.auth.resend({
      type: "signup",
      email: data.user.email,
      options: {
        emailRedirectTo: process.env.NEXT_PUBLIC_SITE_URL
          ? `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/onboarding`
          : undefined,
      },
    });
  }
  redirect("/onboarding?verification=sent");
}
