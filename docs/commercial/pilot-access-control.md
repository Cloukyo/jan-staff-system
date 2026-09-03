# Commercial Pilot Access Control

## Purpose

Commercial owner signup is limited to explicitly approved pilot organisations. The application uses a deterministic HMAC-SHA256 digest of the normalised owner email, so neither the grant table nor release operators need to store plaintext pilot emails.

## Secrets

- `COMMERCIAL_PILOT_SIGNUP_GATE=true` enables the application signup gate in Commercial Production.
- `COMMERCIAL_PILOT_ACCESS_HMAC_SECRET` is a purpose-specific server secret of at least 32 bytes.
- The secret must exist only in trusted operator tooling and the Commercial Production server environment. It must not use a `NEXT_PUBLIC_` name and must never be sent to Supabase.

## Granting pilot access

1. Confirm the applicant's approved work email outside the application.
2. Normalise it with `trim().toLowerCase()`.
3. Calculate `HMAC-SHA256(secret, normalisedEmail)` in trusted server-side or offline operator tooling.
4. Call `grant_commercial_pilot_access(digest, expiry)` using the Commercial Production service role.
5. Record the grant expiry and approval evidence in the restricted operational log. Do not record the HMAC secret.

The signup action reserves the grant atomically, creates the Auth user, and binds the reservation to that user. The database consumes the bound grant only when the organisation crosses the authoritative guarded Go Live boundary.

## Revoking pilot access

Calculate the same digest and call `revoke_commercial_pilot_access(digest)` using the service role. Revocation blocks an unconsumed grant and clears any unbound reservation. A consumed grant is immutable and cannot be silently reused.

## Safety properties

- A conditional database update ensures one signup attempt holds a grant at a time.
- Reservations expire after 15 minutes if signup does not complete.
- Expiry, revocation, binding, Auth-user existence, and previous consumption are checked in the database.
- A second conditional update consumes the grant in the organisation Go Live transaction.
- Failed Go Live transactions roll back grant consumption.
- Local/demo and Commercial Staging remain usable because their database gate is disabled.

## Production rollout preconditions

Keep Supabase public signup disabled until all of these are complete: migration applied, database pilot gate enabled, HMAC secret installed, approved grants created, gated application deployed, and exact-SHA health checks passed. Re-enable provider signup only after those controls are confirmed together.

