import { BrandMark } from "@/components/ui/brand";
import { SignupForm } from "@/components/onboarding/signup-form";

export default function SignupPage() {
  return (
    <main className="onboarding-auth-shell">
      <section className="onboarding-auth-card">
        <BrandMark />
        <div><span>Commercial account</span><h1>Create your owner account</h1><p>Use an email address you control. You will verify it and add multi-factor authentication before creating an organisation.</p></div>
        <SignupForm />
      </section>
      <aside><strong>Secure from the start</strong><p>Organisation ownership cannot be created until your email, authenticator and current legal documents are confirmed.</p></aside>
    </main>
  );
}
