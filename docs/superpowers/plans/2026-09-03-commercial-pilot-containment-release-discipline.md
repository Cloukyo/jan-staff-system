# Commercial Pilot Containment and Release Discipline Implementation Plan

1. Add failing unit, database, route-policy, and release-workflow tests.
2. Add a commercial migration for private pilot grants, atomic reservation/binding, and authoritative Go Live consumption.
3. Add server-only email HMAC and integrate pilot authorisation into owner signup.
4. Make the notification cron authenticated and safe in both staging and production, with delivery disabled by default.
5. Replace cross-project promotion assumptions with exact-SHA staging evidence and protected production deployment checks.
6. Document pilot administration, release operation, product roadmap, and manual security prerequisites.
7. Run focused tests and the full verification suite.
8. Commit and reconcile commercial `main`, deploy the exact candidate to Commercial Staging, verify SHA/health/ledger, and stop before Production promotion.

