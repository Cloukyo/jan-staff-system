# Production communications implementation plan

1. Add failing tests for canonical origins, conditional CAPTCHA tokens, reply-to delivery, webhook verification/routing, and environment fail-closed rules.
2. Implement shared origin and CAPTCHA helpers and connect the three public Auth forms/actions.
3. Implement the authenticated Resend webhook adapter and route using the existing delivery-event RPC.
4. Add optional reply-to support to the existing provider/worker.
5. Add neutral Auth template sources, environment examples, provider/domain activation runbook, and roadmap status.
6. Run focused tests during development, then one complete release gate.
7. Commit and use the guarded Commercial Staging workflow only. Do not configure Production or external provider/DNS state.
