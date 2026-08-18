# Supervised Pilot Manual Closure

This procedure is non-destructive. Cancellation does not delete customer records, attendance evidence, corrections, rota, leave, payroll or compliance history. Automated deletion is outside the pilot scope.

## Preconditions

1. Verify the requester is an active organisation owner using AAL2.
2. Record the request, request time in Europe/London, support case ID, organisation ID and the staff member handling it.
3. Record whether a legal hold, safeguarding requirement, payroll dispute or statutory retention obligation applies.
4. Stop if authority, scope or retention requirements are unclear.

## Final export

1. Ask the owner to download the versioned organisation JSON export.
2. Verify its manifest, category counts and SHA-256 digest against the immutable export audit receipt.
3. Record any explicitly omitted file bytes and agree how authorised document files will be supplied separately.
4. Obtain written confirmation that the owner has received and checked the export.

## Access closure

1. Schedule subscription cancellation at period end through the supported billing workflow.
2. After the approved closure time, revoke interactive memberships and online kiosk credentials using supported administration workflows.
3. Revoke customer-specific provider access without deleting immutable application evidence.
4. Confirm offline-enabled devices and offline authorisations remain zero.

## Retention and later deletion

Record the approved retention date for each evidence category. Do not delete or anonymise data during this pilot procedure. Any later deletion or anonymisation requires a separately approved runbook, a fresh backup check, legal sign-off, exact table scope, tenant fencing, dry-run counts and completion evidence.

## Completion evidence

Record the final organisation state, subscription state, active membership/device counts, export audit ID and digest, evidence counts, legal-hold result, incident/contact details, and the identity of the approver. Preserve the support case and audit evidence.
