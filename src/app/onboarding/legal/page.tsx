import { redirect } from "next/navigation";
import { FileText } from "lucide-react";
import { randomUUID } from "node:crypto";
import { LegalAcceptanceForm } from "@/components/onboarding/legal-acceptance-form";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { loadOnboardingBootstrapServer } from "@/lib/onboarding/server";

export const dynamic = "force-dynamic";

export default async function LegalAcceptancePage() {
  const snapshot = await loadOnboardingBootstrapServer();
  if (!snapshot.security.emailVerified || snapshot.security.assuranceLevel !== "aal2") redirect("/onboarding");
  if (snapshot.session.organisationId) redirect("/onboarding/next");
  if (snapshot.security.legalAcceptancesCurrent) redirect("/onboarding/organisation");
  return (
    <OnboardingShell activeStep="legal_acceptance" completedSteps={["owner_security"]}>
      <div className="onboarding-page-heading"><span>Owner agreement</span><h1>Review the legal documents</h1><p>These versions apply to your commercial account. A future version will require a new acceptance.</p></div>
      <div className="onboarding-document-list">
        {snapshot.legalDocuments.map((document) => <article key={document.documentType}><FileText aria-hidden /><div><h2>{document.title}</h2><p>{document.summary}</p><small>Version {document.documentVersion} · {document.locale}</small></div></article>)}
      </div>
      <LegalAcceptanceForm sessionRevision={snapshot.session.revision} idempotencyKey={randomUUID()} documents={snapshot.legalDocuments} />
    </OnboardingShell>
  );
}
