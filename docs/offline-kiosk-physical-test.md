# Offline Staff Clock Physical Device Test

## Gate

Offline clocking must remain disabled until every mandatory check below passes on the actual Jan Preschool kiosk. Desktop simulation is not a substitute for this test. Use fictional staff and attendance in preview or staging. Do not run destructive storage tests against a device holding real unsynchronised evidence.

## Device record

| Field | Result |
| --- | --- |
| Test date and tester | |
| Manufacturer and model | |
| Operating system and version | |
| Browser and version | |
| Installed Home Screen PWA or browser tab | |
| Available and total storage | |
| Screen lock and kiosk-mode configuration | |
| Managed-device controls | |
| Network type | |
| Device restart permitted during test | Yes / No |
| Background Sync supported | Yes / No / Unknown |
| Wake Lock supported and effective | Yes / No / Unknown |

## Test procedure

For every step record pass, fail or not run, the observed time in UK format, pending count before and after, relevant action UUIDs, matching server event IDs and notes. Stop immediately if an action disappears, duplicates or pairs across London operational days.

1. **Initial provisioning online:** register the fictional kiosk, verify hardware in preview, enable only that preview device, open Staff Clock and confirm the 24-hour authorisation, minimum roster and zero queue.
2. **Install and update:** test first install, browser-tab use and Home Screen PWA use separately. Confirm the service worker controls only `/clock` and an update does not clear IndexedDB.
3. **Disconnect:** disable Wi-Fi and mobile data. Confirm the status changes only after a real health request fails and says actions will synchronise later.
4. **Offline PIN:** verify a correct six-digit enrolled PIN, three incorrect attempts, persistent lockout, reload persistence and tamper detection. Confirm the entered PIN is not persisted.
5. **Offline clock-in and clock-out:** queue each explicit action and confirm the local-only wording, occurrence time and pending count.
6. **Page reload:** reload with actions pending and confirm the provisional state and queue are reconstructed.
7. **Close and reopen:** fully close the tab or PWA, reopen it and confirm the queue, roster, keys, verifier and provisional state remain.
8. **Restart tablet:** restart the device, reopen Staff Clock and repeat the persistence checks.
9. **Reconnect:** restore the network and confirm foreground sync starts without relying on Background Sync.
10. **Exactly-once result:** compare action UUID, device sequence and occurrence time with the action receipt and immutable server event. Retry after a simulated lost response and confirm there is one event only.
11. **Manager correction during outage:** disconnect, queue an action, make a conflicting fictional manager correction online, reconnect and confirm an attendance exception appears without an automatic event.
12. **Device clock change:** while offline, change the device clock within the small, moderate and large drift ranges. Restore the correct clock after each case. Confirm audit metadata, warning and conflict thresholds.
13. **Authorisation expiry:** allow or simulate expiry, confirm existing evidence remains and new offline actions stop, then reconnect and refresh.
14. **Revocation:** queue fictional evidence, revoke the device while it is offline, reconnect and confirm new actions are rejected while the queued evidence and manager conflict remain visible.
15. **Multiple staff:** queue ordered actions for at least two fictional staff. Create a conflict for one and confirm the other staff member continues syncing.
16. **Storage pressure:** only on an empty test device, safely reduce available storage or deny persistence. Confirm a blocking warning and no claimed local success when durable storage fails.
17. **Wake Lock and kiosk mode:** test each separately. Record whether Wake Lock survives normal use and whether kiosk mode prevents navigation without blocking restart and recovery.
18. **Expected OS lifecycle:** leave the PWA backgrounded for the nursery's normal maximum interval, allow screen lock, restart the service worker and reopen. Confirm all pending evidence survives.

Also test Europe/London DST start and end with controlled fictional timestamps, installed-PWA and browser-tab behaviour, network loss mid-batch, visibility-regain sync, manual Sync now, app relaunch sync and Background Sync repeated or unavailable.

## Results template

| ID | Mode | Started (UK) | Expected | Observed | Pending before / after | Action UUID / event ID | Pass / Fail / Not run | Evidence and notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | PWA / tab | | | | | | | |
| 2 | PWA / tab | | | | | | | |
| 3 | PWA / tab | | | | | | | |
| 4 | PWA / tab | | | | | | | |
| 5 | PWA / tab | | | | | | | |
| 6 | PWA / tab | | | | | | | |
| 7 | PWA / tab | | | | | | | |
| 8 | PWA / tab | | | | | | | |
| 9 | PWA / tab | | | | | | | |
| 10 | PWA / tab | | | | | | | |
| 11 | PWA / tab | | | | | | | |
| 12 | PWA / tab | | | | | | | |
| 13 | PWA / tab | | | | | | | |
| 14 | PWA / tab | | | | | | | |
| 15 | PWA / tab | | | | | | | |
| 16 | PWA / tab | | | | | | | |
| 17 | PWA / tab | | | | | | | |
| 18 | PWA / tab | | | | | | | |

## Sign-off

| Decision | Name | Date | Notes |
| --- | --- | --- | --- |
| Technical pass | | | |
| Nursery operational pass | | | |
| Security and device-management pass | | | |
| Approved for one-device pilot | | | |

Any mandatory failure leaves `offline_enabled` false. Retain screenshots, action UUIDs, SQL verification output and this completed record with the pilot evidence.
