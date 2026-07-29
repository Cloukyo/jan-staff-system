# Attendance Removal and Reset to Planned Hours

## Goal

Give nursery managers a straightforward way to recover a day whose clock events or previous corrections are wrong, without deleting the original attendance record.

## Manager Workflows

### Remove one event

Each effective clock event has a **Remove from hours** action alongside its existing correction controls.

The manager must enter a reason and confirm the removal. The event then stops contributing to worked hours and attendance sequence checks. The original event or earlier manager correction remains visible in clocking history as superseded or excluded.

### Reset a day

The existing planned-hours area offers **Reset to planned hours** even when the current event sequence is too ambiguous for the existing automatic correction.

Before saving, the interface shows:

- every currently effective event that will be removed from hours;
- the published clock-in and clock-out that will be added;
- a warning that intermediate events, including lunch events, will be removed;
- a reminder that lunch clock-out and clock-in events must be added manually afterward.

The manager enters a reason and confirms the reset. The result contains exactly two effective boundary events at the earliest published start and latest published finish. The manager can then use **Add missing event** to add the lunch clock-out and clock-in.

If no published shift exists for the day, reset is unavailable.

## Data and Audit Rules

Original kiosk events are immutable.

Removing an original event appends an `exclude` correction linked to that original. Removing an active manager correction appends an `exclude` correction that supersedes the active correction.

Reset runs as one database transaction under the existing manager-only attendance write lock. It:

1. verifies the staff member, date, published shift and attendance revision;
2. appends exclusions for all currently effective events;
3. appends a clock-in at the published start;
4. appends a clock-out at the published finish;
5. records one manager reason and a shared batch identifier for the operation.

Concurrent or stale submissions fail without writing a partial reset. Repeating the same submitted operation is idempotent.

## Hours and Export Behaviour

Worked-hours calculations and payroll preparation use the effective events after corrections.

For a published 08:00 to 18:00 shift:

- immediately after reset, corrected worked hours are 10.00;
- after adding a 12:00 clock-out and 13:00 clock-in, corrected worked hours are 9.00.

The **Daily Clocking** export continues to show:

- preserved kiosk events in **Original clock-ins** and **Original clock-outs**;
- the original calculation in **Raw worked hours**;
- the reset and lunch corrections in the manager-correction and audit columns;
- the final effective calculation in **Worked hours including corrections**.

Excluded events do not contribute to the corrected total.

## Interface and Accessibility

Use **Remove from hours**, not **Delete**, because records remain in the audit history.

Removal and reset use clear destructive styling, large touch targets and an explicit confirmation step. The reset confirmation identifies the staff member and date. Success returns the manager to the same expanded attendance day and refreshes its timeline and totals.

## Error Handling

The interface explains these cases without losing entered form data:

- the attendance day changed since it was opened;
- the published shift changed or was removed;
- an event is no longer active;
- the manager session expired;
- the database transaction failed.

No failure may leave only part of a reset applied.

## Testing

Tests cover:

- excluding original and manager-added events without deleting history;
- manager authorization, reason validation and stale revisions;
- atomic reset of malformed and already-correct event sequences;
- idempotent retries;
- exact effective events and worked minutes after reset;
- lunch events added after reset reducing corrected worked hours;
- export separation of original, corrected and audit values;
- visible labels, confirmation copy and disabled states;
- regression coverage for existing manual corrections and planned-hours behaviour.

Run lint, type checking, the complete test suite and a production build. Verify the workflow in the browser at desktop and mobile sizes before deployment.
