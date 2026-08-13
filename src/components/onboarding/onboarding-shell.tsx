import Link from "next/link";
import { Check, Circle, HelpCircle, LockKeyhole, LogOut } from "lucide-react";
import { BrandMark } from "@/components/ui/brand";
import { signOutAction } from "@/lib/auth/actions";
import type { ReactNode } from "react";

type ProgressKey = "owner_security" | "legal_acceptance" | "organisation" | "first_site" | "subscription" | "staffing" | "manager_invitations";

const steps: Array<{ key: ProgressKey; label: string }> = [
  { key: "owner_security", label: "Account security" },
  { key: "legal_acceptance", label: "Legal acceptance" },
  { key: "organisation", label: "Organisation" },
  { key: "first_site", label: "First site" },
  { key: "subscription", label: "Plan and trial" },
  { key: "staffing", label: "Initial staffing" },
  { key: "manager_invitations", label: "Managers" },
];

export function OnboardingShell({
  activeStep,
  completedSteps,
  children,
}: {
  activeStep: ProgressKey;
  completedSteps: ProgressKey[];
  children: ReactNode;
}) {
  return (
    <main className="onboarding-shell">
      <header className="onboarding-header">
        <BrandMark />
        <div className="onboarding-header__actions">
          <Link href="mailto:support@example.invalid" className="onboarding-help-link"><HelpCircle aria-hidden /> Need help?</Link>
          <form action={signOutAction}><button className="onboarding-signout" type="submit"><LogOut aria-hidden /> Sign out</button></form>
        </div>
      </header>

      <div className="onboarding-mobile-progress" aria-label="Onboarding progress">
        <p>Step {steps.findIndex((step) => step.key === activeStep) + 1} of {steps.length}</p>
        <strong>{steps.find((step) => step.key === activeStep)?.label}</strong>
        <div aria-hidden><span style={{ width: `${((steps.findIndex((step) => step.key === activeStep) + 1) / steps.length) * 100}%` }} /></div>
      </div>

      <div className="onboarding-layout">
        <aside className="onboarding-sidebar">
          <nav aria-label="Onboarding progress">
            <ol>
              {steps.map((step) => {
                const complete = completedSteps.includes(step.key);
                const active = step.key === activeStep;
                return (
                  <li key={step.key} aria-current={active ? "step" : undefined} data-state={complete ? "complete" : active ? "active" : "pending"}>
                    <span>{complete ? <Check aria-hidden /> : <Circle aria-hidden />}</span>
                    <div><strong>{step.label}</strong><small>{complete ? "Complete" : active ? "Current step" : "Not started"}</small></div>
                  </li>
                );
              })}
            </ol>
          </nav>
          <div className="onboarding-sidebar__support">
            <HelpCircle aria-hidden />
            <div><strong>Need help?</strong><p>Support can help you complete setup safely.</p><Link href="mailto:support@example.invalid">Contact support</Link></div>
          </div>
        </aside>

        <section className="onboarding-content">
          <div className="onboarding-content__main">{children}</div>
          <aside className="onboarding-reassurance">
            <LockKeyhole aria-hidden />
            <div><strong>Your setup is saved securely</strong><p>You can sign out and return from any device to continue.</p></div>
          </aside>
        </section>
      </div>
    </main>
  );
}

export function OnboardingNotice({ tone = "warning", children }: { tone?: "warning" | "error" | "success"; children: ReactNode }) {
  return <div className={`onboarding-notice onboarding-notice--${tone}`} role={tone === "error" ? "alert" : "status"}>{children}</div>;
}
