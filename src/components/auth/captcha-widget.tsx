"use client";

import Script from "next/script";
import { useEffect, useRef } from "react";

type TurnstileWindow = Window & {
  turnstile?: { reset(container?: HTMLElement): void };
};

export function AuthCaptcha({ pending }: { pending: boolean }) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  const containerRef = useRef<HTMLDivElement>(null);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending && containerRef.current) {
      (window as TurnstileWindow).turnstile?.reset(containerRef.current);
    }
    wasPending.current = pending;
  }, [pending]);

  if (!siteKey) return null;
  return (
    <div className="grid gap-2" aria-label="Security check">
      <Script id="cloudflare-turnstile" src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />
      <p className="text-sm font-bold text-purple-950">Security check</p>
      <div
        ref={containerRef}
        className="cf-turnstile min-h-16"
        data-sitekey={siteKey}
        data-response-field-name="cf-turnstile-response"
        data-theme="light"
      />
      <noscript><p className="text-sm text-red-800">JavaScript is required to complete the security check.</p></noscript>
    </div>
  );
}
