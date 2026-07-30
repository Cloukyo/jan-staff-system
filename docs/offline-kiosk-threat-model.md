# Offline Staff Clock Threat Model

## Status

Offline clocking is disabled by default. It may be enabled only for a registered device after the real Jan Preschool kiosk has passed the hardware and browser checklist in this document.

Repository inspection did not identify the kiosk model, operating system, browser and version, installed-PWA mode, storage policy, or managed-device controls. Until those details are recorded and tested, the device is not hardware verified.

## Authority boundary

The server-side effective attendance ledger is the sole attendance authority. IndexedDB contains provisional requests, trusted snapshots, device-bound PIN verifiers, receipts, and diagnostics. Local records never become clock events and never contribute to payroll until the server accepts them.

The service worker caches only the narrow Staff Clock shell and immutable static assets. It does not cache manager pages, payroll pages, compliance pages, Supabase responses, or offline API responses.

## Protected information

- Original and corrected attendance evidence
- Staff identifiers and the minimum offline roster
- Device registration and offline authorisation identifiers
- Device private signing key and verifier key
- Device-specific offline PIN verifier envelopes
- Signed pending actions and definitive receipts
- Manager-only device health and discard audit

The kiosk must never store plaintext PINs, production bcrypt hashes, salary, hourly rates, contact details, compliance records, leave documents, or manager credentials.

## Threats and controls

### Offline PIN guessing

An attacker may try PIN combinations without contacting the server. Offline enrolment therefore requires six digits, uses a slow salted derivation and a device-specific non-extractable verifier key, expires after no more than 24 hours, and permits three failed comparisons. The fourth attempt is locked until a successful reconnect.

This rate limit is a compensating control, not proof against a fully compromised browser.

### Developer tools and IndexedDB inspection

A person with physical access may inspect or edit IndexedDB. Stored verifier values do not reveal the plaintext PIN or production PIN hash. Lockout records are authenticated so ordinary editing is detected. Queue records remain signed and are revalidated by the server.

Browser storage cannot be considered secret from code executing in the same origin.

### Invocation of non-extractable keys

Non-extractable Web Crypto keys cannot be exported through the normal API, but malicious same-origin code may still ask the browser to use them. Content security, dependency review, XSS prevention, kiosk operating-system restrictions, short authorisation lifetime, and device revocation are required.

### Device theft

A stolen device may retain the installed shell, cached roster, non-extractable keys, and pending evidence. Managers must be able to revoke the registration and authorisation. The server rejects new actions after revocation. Local expiry is applied conservatively while offline.

### Service-worker compromise

A compromised service worker could alter the visible shell or intercept same-origin traffic. Cache scope is limited to `/clock`, cache names are versioned, API responses are excluded, and activation removes obsolete shell caches. Deployments must retain a rollback path and confirm the active worker version.

### Cross-site scripting

XSS in the kiosk origin can invoke browser keys and alter local presentation. Kiosk UI must avoid unsafe HTML, validate all server data, maintain a restrictive content security policy, and minimise third-party script execution.

### Replay and copied queue rows

Each action has one stable UUID, authorisation, registered device, device sequence, staff member, action, occurrence time, trusted revision, and signature. The server repeats identity checks and idempotency enforcement. Reusing a UUID with changed content fails.

Copying a signed row to another device fails device and authorisation checks. Replaying an accepted row returns its stored outcome without creating another event.

### Timestamp tampering

Offline evidence stores occurrence time and server receipt time separately. The client also retains the trusted server/device clock anchor. The server checks authorisation bounds, sequence, timezone, future time, suspicious pre-contact time, drift, and elapsed-time confidence. Uncertain or excessive drift creates conflict evidence rather than normal payroll time.

### Revocation delay

An offline device cannot learn about revocation immediately. Authorisations therefore expire within 24 hours. The server enforces revocation at sync even if the client still displays a cached ready state.

### Storage eviction and update failure

The browser may evict IndexedDB or service-worker caches. The kiosk must request persistent storage where supported, display storage health, keep the online path operational after registration failure, and refuse offline actions without a complete trusted snapshot and verifier.

Pending, conflicted, or indeterminate actions are never removed by routine cleanup. A destructive reset requires manager authentication where possible, a reason, a diagnostic export, and an audit record.

### Browser-side encryption limitation

Encrypting browser storage does not make it confidential from the running origin because the origin must be able to use the decryption key. Device-bound non-extractable keys reduce casual copying but do not make the PWA tamper-proof.

## Physical device verification checklist

Record all results against the exact production kiosk:

- [ ] Manufacturer and model
- [ ] Operating system and version
- [ ] Browser and version
- [ ] Installed-PWA or browser-tab mode
- [ ] Managed-device or kiosk-mode policy
- [ ] Persistent storage request and observed quota
- [ ] IndexedDB survives browser restart
- [ ] IndexedDB survives device restart
- [ ] Non-extractable signing key survives browser restart
- [ ] Non-extractable verifier key survives browser restart
- [ ] Service-worker update preserves pending actions
- [ ] Foreground reconnect sync works without Background Sync
- [ ] Background Sync support is recorded, if present
- [ ] Network loss during submission preserves the same UUID
- [ ] Storage-pressure behaviour is tested
- [ ] Manual device clock change produces conflict evidence
- [ ] UK daylight-saving transition behaviour is tested
- [ ] Remote revocation prevents server acceptance
- [ ] Device deregistration preserves diagnostics and pending evidence
- [ ] Manager diagnostic export is readable
- [ ] Touch targets and status messages are usable by nursery staff

## Enablement decision

Offline clocking remains disabled for a device if any mandatory persistence, key, recovery, revocation, or managed-device check fails. The online kiosk and documented manager attendance procedure remain the fallback during outages.
