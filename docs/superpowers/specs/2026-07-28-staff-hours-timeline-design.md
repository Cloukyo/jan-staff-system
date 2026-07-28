# Staff Hours Timeline and Clock Event Correction Design

## Purpose

Make attendance corrections understandable for a non-technical nursery manager.
The manager must be able to open one staff member, see their clock-in and
clock-out sequence for the current working week, identify missing or reversed
events, and correct the record without changing the original kiosk events.

The design also adds a direct Yesterday view because attendance is most often
checked on the following day.

## Approved User Experience

### Attendance navigation

The Clock-ins & hours submenu will contain:

1. Needs attention
2. Today
3. Yesterday
4. Staff hours
5. Clocking history

Yesterday uses the previous calendar date in the Europe/London timezone. It
shows that day's staff attendance with problem records first and provides the
same correction controls as the individual staff view.

The existing prominent Add a missing clock-in or clock-out command remains
available.

### Staff hours list

Hours summary will be renamed Staff hours.

The first screen shows every active staff member for the selected date range.
It defaults to the configured current working week and provides previous week,
next week and custom date-range controls.

Each staff row shows:

- staff name;
- completed effective hours;
- whether a shift is still open;
- the number of days needing attention;
- an Open hours action.

Staff with unresolved clocking problems appear before staff with complete
records. The normal alphabetical order is used within each group.

### Individual staff week

Opening a staff member displays one row per relevant day in the selected week.
A day is relevant when it has a published rota shift, an original clock event,
a manager correction or an attendance review.

Each row shows:

- date;
- planned rota period or periods;
- effective clock-in and clock-out sequence;
- calculated effective hours;
- a clear status;
- an Open action.

Statuses include:

- Complete;
- Missing clock-in;
- Missing clock-out;
- Clock-out before clock-in;
- Duplicate clock-in;
- Duplicate clock-out;
- Events in the wrong order;
- No planned shift.

Problem rows use a strong warning treatment and clear words. Colour is
supporting information, not the only indication.

### Expanded day timeline

Opening a day shows three related views:

1. Planned rota periods.
2. Original kiosk events in chronological order.
3. The effective sequence used for hours after manager corrections.

Each event displays its type, UK-formatted time and source. Corrected events
are labelled Manager correction. A replaced original remains visible and is
labelled Original, replaced.

The timeline is accompanied by a compact event table on narrow screens so the
same information remains readable without horizontal precision.

### Correction actions

Fix event opens a small form for the selected event. The manager can:

- choose Clock in or Clock out from a dropdown;
- type or select the correct date and time;
- enter a correction reason;
- review the original value before saving.

Add missing event opens the same form with the staff member and date already
selected. The event type uses a dropdown and the time field supports both
typing and the platform time picker.

Use planned hours is available when the day has at least one published rota
period. Before saving, it shows the exact periods that will be used and asks
for confirmation. It creates an effective clock-in and clock-out pair for
every published rota period on the day.

Use planned hours does not appear when there is no published rota. It never
changes the rota itself.

After a successful action, the same staff member, date range and expanded day
remain open so the manager can immediately verify the result.

## Correction Audit Model

Original clock events remain immutable.

A new append-only `clock_event_corrections` table stores manager changes
separately from `clock_events`. Each correction contains:

- correction ID;
- staff ID;
- optional original clock event ID;
- optional correction ID that this record supersedes;
- correction kind: add, replace or exclude;
- effective event type;
- effective event timestamp;
- manager reason;
- correcting manager account ID;
- creation timestamp.

A replacement references the original event that it corrects. A missing event
uses the add kind and has no original event. An exclusion removes an incorrect
event from effective calculations but leaves that event visible in the audit
trail. If a correction itself needs to be changed, a new correction supersedes
it. No correction row is updated or deleted.

Existing manager correction rows already stored in `clock_events` remain
valid and continue to appear in the audit trail. They are treated as legacy
manager-added events by the effective event resolver.

Row-level security allows managers to read and insert corrections. Staff
cannot create, update or delete manager corrections. Staff self-service
correction requests remain requests only.

## Effective Event Resolution

A shared resolver produces the event sequence used by attendance views,
current kiosk status, staff-hours totals and pay preparation.

For a staff member and date range it:

1. loads original and legacy manager clock events;
2. loads the applicable append-only corrections;
3. selects the newest non-superseded correction in each correction chain;
4. excludes an original event from the effective sequence when an active
   replacement or exclusion targets it;
5. includes active replacement and added effective events;
6. sorts effective events by timestamp with a stable ID tie-breaker;
7. pairs clock-in followed by clock-out without silently repairing invalid
   sequences.

The resolver returns both the immutable audit records and the effective
records. Consumers must choose explicitly which representation they need.

Raw clocking history and audit exports continue to expose original and manager
records separately. Calculated worked hours use the effective sequence.

## Sequence Analysis

A pure TypeScript sequence analyser accepts planned rota periods and effective
events for one staff day. It returns:

- paired work sessions;
- completed minutes;
- open-shift state;
- ordered warnings;
- suggested missing event type where the sequence makes it unambiguous.

The analyser does not guess a time. Suggested times come only from a published
rota period and are shown to the manager for confirmation.

The same analyser drives the warning labels, weekly issue counts and expanded
timeline. This prevents the list and detail views from disagreeing.

## Server and Component Boundaries

Server-only modules load authorised attendance data and create immutable
corrections. Pure sequence and presentation models live outside client
components so server pages can call them safely.

The main units are:

- attendance correction repository and server actions;
- effective event resolver;
- pure daily sequence analyser;
- staff-hours list loader;
- individual staff-week loader;
- Yesterday daily loader;
- staff-hours list component;
- staff-week timeline component;
- correction forms and planned-hours confirmation.

Client components manage expansion, form state and confirmation only. They do
not calculate authoritative hours.

## Validation and Failure Handling

All correction actions require a manager account.

The server validates:

- staff member exists;
- original event belongs to the selected staff member;
- event type is valid;
- timestamp is a real date and is converted using Europe/London semantics;
- reason contains at least five non-space characters;
- replacement and superseded correction references are valid;
- planned-hours action uses currently published, non-cancelled rota periods.

Use planned hours reloads the rota inside the server action rather than
trusting times posted by the browser.

The planned-hours database function excludes every currently effective event
for the selected staff day and adds the published rota start and end pairs as
one correction batch. This handles missing, reversed, duplicate and extra
events consistently. If saving fails, no partial correction batch is retained.

User-facing failures explain what the manager can do next and do not expose
database details.

## Accessibility and Responsive Behaviour

- Interactive controls have at least 44px touch targets.
- Buttons use icons where familiar and include accessible labels.
- Warnings contain text and do not rely on colour.
- Expanded details use semantic headings and tables.
- Focus moves to the result message after a correction.
- Mobile uses stacked day rows and an event table instead of requiring a wide
  horizontal timeline.
- Times and dates use UK formats.

## Testing

Pure unit tests cover:

- complete in/out pairs;
- missing first clock-in;
- missing final clock-out;
- clock-out before clock-in;
- duplicate and reversed events;
- multiple same-day rota periods;
- effective replacement of an original event;
- an added missing event;
- exclusion of an incorrect or duplicate event;
- a superseding correction;
- legacy manager correction compatibility;
- Europe/London date boundaries.

Server and source-boundary tests cover:

- manager-only correction creation;
- immutable original records;
- row-level security;
- transactional Use planned hours behaviour;
- consistent effective totals in attendance, kiosk status and pay preparation;
- Yesterday resolving to the previous London date;
- retained staff/date/week query parameters after saving.

Browser verification covers desktop and mobile:

- opening Staff hours;
- opening Margaret Q;
- seeing a reversed sequence warning;
- fixing event type and time;
- adding a missing event;
- using planned hours after confirming the displayed rota;
- verifying the corrected total and retained audit display;
- navigating directly to Yesterday.

Lint, type checking, the full Vitest suite and the production build must pass
before deployment.

## Deployment

The database migration is additive and preserves all existing clock and
correction records. The migration is applied before the application release.

The release is deployed to a preview environment first. After authenticated
browser verification, it is promoted to production. Production checks confirm
that Staff hours, Yesterday, manual correction and Use planned hours load
without runtime errors.
