# Manager UX and UI Audit

Date: 27 July 2026

Status: Findings and recommended design for review. No interface changes are included in this document.

## Purpose

This audit reviews the manager experience before production, with the nursery manager as the primary user.

The main test is:

> Would a busy nursery manager know where to click and what will happen without being trained by the developer?

The audit focuses on:

- familiar wording
- finding important actions quickly
- reducing long pages and repeated forms
- keeping related staff tasks together
- making mobile use practical
- preserving the application's attendance, pay and privacy rules

## Audit Method

The review covered the live manager system, the local route structure and the main manager components.

The workflows reviewed were:

1. Add a staff member.
2. Change a staff member's name or employment details.
3. Enable clocking in and set a PIN.
4. Create and edit the rota.
5. Review leave requests.
6. Review and correct clock-ins.
7. Check hours before sending them for pay processing.
8. Find settings when something looks wrong.

Both desktop and a 390 by 844 mobile viewport were checked. The mobile navigation opened correctly and the checked pages did not have horizontal overflow.

## Executive Finding

The visual styling is reasonably consistent and readable. The primary production risk is the information architecture.

The system currently exposes its technical structure to the manager. A single ordinary task such as managing an employee is divided across Staff, Compliance, Accounts, Pay arrangements and Kiosk setup. The manager has to remember which technical area owns each setting.

Long pages then make those settings difficult to find:

| Screen | Desktop page height observed | Mobile page height observed | Main issue |
| --- | ---: | ---: | --- |
| Attendance | over 13,000 px | over 23,000 px | Daily review, hours, corrections and history are one page |
| Clocking-in setup | over 6,500 px | over 10,000 px | Device management appears before employee PIN controls |
| Employee record | about 6,800 px | not measured | Eight unrelated record sections are stacked vertically |
| Staff compliance list | about 3,500 px | not measured | Wide table, repeated quick-edit forms and generic View actions |
| Staff list | about 2,600 px | over 5,300 px | Repeated cards and actions for every employee |

This confirms the reported problem: important features are present, but they are hidden by page length, technical labels and fragmented workflows.

## Design Approaches

### Approach A: Wording only

Rename navigation items and buttons without moving features.

Advantages:

- fastest and lowest risk
- immediately removes some technical language
- routes and data behaviour remain unchanged

Limitations:

- employee management remains split across several pages
- long pages remain long
- managers still need to remember where settings live

This is useful as an initial release, but it is not sufficient before production on its own.

### Approach B: Workflow-led consolidation

Use familiar navigation labels, create one staff directory, and put related employee settings inside each employee record. Split long operational pages into task-based views.

Advantages:

- matches how managers think about the work
- removes most menu ambiguity
- directly fixes the new employee, renamed employee and disabled clocking-in problems
- can reuse the current routes and server actions behind the new interface

Limitations:

- requires coordinated changes across several manager screens
- needs careful regression testing around attendance and private pay data

This is the recommended approach.

### Approach C: Full interface rebuild

Replace the current manager shell and all feature screens at once.

Advantages:

- maximum visual consistency
- no need to preserve current page layouts

Limitations:

- largest regression risk before production
- delays operational fixes
- likely to change working features unnecessarily

This approach is not recommended.

## Recommended Navigation

The main menu should describe manager tasks, not database areas.

### Daily work

- Home
- Rota
- Clock-ins & hours
- Leave requests

### Staff

- Staff records

### Pay hours

- Export pay hours

### Settings

- Rota templates
- Clocking-in devices
- Nursery settings

The following items should no longer be separate primary navigation destinations:

- Compliance
- Accounts
- Pay arrangements
- Payroll review

Their functions should be reached from the relevant staff record or from a clearly labelled advanced action.

## Recommended Wording

| Current wording | Recommended wording | Reason |
| --- | --- | --- |
| Dashboard | Home | Familiar starting point |
| Attendance | Clock-ins & hours | Describes what the manager is reviewing |
| Leave | Leave requests | Makes the manager task explicit |
| Staff | Staff records | Distinguishes records from the staff-facing area |
| Compliance | Training & checks | Familiar description of certificates, DBS and references |
| Accounts | Staff logins | Makes clear that this controls app login access |
| Pay arrangements | Pay details | Plainer wording for rates, salary basis and contracted hours |
| Payroll review | Import pay details | The page imports and validates a workbook, not payroll generally |
| Pay preparation | Export pay hours | Describes the main output and avoids implying full payroll |
| Kiosk setup | Clocking-in devices | Avoids technical kiosk terminology in the manager menu |
| Staff kiosk access and PINs | Clocking-in access and PINs | Uses the language staff and managers use |
| Production data \| Supabase | Remove from normal pages | This is system information, not a manager task |
| Canonical staff profile | Staff record | Avoids database language |
| Preferred name | Name shown on Staff Clock | Explains why changing it affects the clocking-in screen |
| Staff Clock enabled | Can use Staff Clock | Reads as a clear permission |
| Save access | Save clocking-in access | Names the setting being saved |
| Add missed clock event | Add a missing clock-in or clock-out | Makes the action explicit |
| Staff hours preview | Hours summary | Shorter and more familiar |
| Recent clock history | Clocking history | Clearer and shorter |
| Manage pay | Pay details | Describes the destination rather than a broad action |
| View | Open record | A specific action is easier to scan |

Technical terms such as Supabase, Auth, UUID, canonical, batch and effective-dated should appear only where an advanced administrator genuinely needs them. They should not be in ordinary manager instructions.

## Staff Records Design

### Staff directory

The Staff records page becomes the only normal place to add, find and manage employees.

The first viewport should contain:

- page title
- search
- filters for Active, Needs setup and Inactive
- Add staff member button
- compact staff list

Each row should show:

- staff name
- role
- active or inactive
- clocking-in status
- important setup warning
- Open record action

Pay values must not appear in the general staff list.

### Employee record

The employee record should use tabs or a compact section navigation:

1. Overview
2. Employment
3. Clocking in
4. Staff login
5. Training & checks
6. Pay details

The Overview tab should show a setup checklist:

- employment details complete
- can use Staff Clock
- PIN ready
- staff login enabled or not required
- required training and checks
- pay details present

This puts the currently fragmented workflow in one place while preserving permission boundaries.

### Adding an employee

Add staff member should open a focused form instead of permanently occupying the top of a long list.

After save, the manager should be taken to the new employee's Overview tab with the setup checklist visible. Enabling Staff Clock and setting a temporary PIN should be possible from the Clocking in tab without visiting Settings.

### Changing a name

The form should distinguish:

- Full legal name
- Name shown on Staff Clock

Saving either field should refresh all affected manager pages and the Staff Clock roster. The Clocking in tab should include a manager-only Refresh Staff Clock action for recovery when a shared device is still displaying old information.

## Clock-ins & Hours Design

The current Attendance page combines too many jobs. It should become a page with task tabs:

- Needs attention
- Today
- Hours summary
- Clocking history

### Needs attention

Show only days requiring a decision. Each item should have one decision control with clear choices:

- Approve recorded times
- Enter corrected times
- Accept exception with reason
- Mark for follow-up

Do not render four separate reason fields for every employee before the manager chooses an action.

### Today

Show:

- who is currently clocked in
- scheduled staff who have not clocked in
- missing clock-outs
- a direct Add missing clock-in or clock-out action

### Hours summary

Keep date filters and the staff hours table together. Link unresolved entries back to Needs attention.

### Clocking history

Place the immutable event history in its own searchable and paginated view. Original clock events remain unchanged. Manager corrections remain separate and visibly identified.

## Clocking-in Devices Design

Device registration and employee PIN management are different tasks and should not be stacked on one long page.

The Settings page should contain Clocking-in devices for:

- registering the current browser
- viewing registered devices
- revoking a device
- opening Staff Clock

Employee access and PIN controls belong inside each employee record under Clocking in.

If a bulk manager view is retained, it should include:

- staff search
- Needs setup filter
- compact status rows
- Open employee action

It should not render the full PIN form for every employee at once.

## Leave Requests Design

Leave requests is already one of the shorter and clearer manager areas.

Recommended changes:

- keep Review requests as the manager default
- show the pending count in the navigation
- show pending requests before filters when any exist
- rename My requests to My leave when viewed by a manager as an employee
- keep Rota conflicts as a secondary link from approved requests and the rota

The future WhatsApp request channel should create the same pending leave request record. It should not introduce a separate manager approval screen.

## Rota Design

Rota is familiar wording and should remain.

The current first area contains week navigation, template use, workbook export, copy tools, clearing and archiving. These have different risk levels.

Recommended grouping:

- primary: week navigation, publish status and Add shift
- common tools: Copy previous week and Apply template
- export: Download rota
- More menu: Copy day, Clear day, Return to draft and Archive week

Destructive actions should not compete visually with everyday rota editing.

## Pay Hours Design

The current Pay menu contains three similar labels with different purposes.

Recommended structure:

- Pay details inside each employee record
- Export pay hours as the main manager page
- Import pay details as an advanced action from Pay details

Export pay hours should continue to state clearly that:

- it is preparation only
- unresolved attendance may make hours inaccurate
- no PAYE, National Insurance, pension, statutory deductions or payslips are calculated

Salary and pay-rate information must remain manager-only and must never appear on Staff Clock.

## Home Design

The current Dashboard shows twelve equal Live cards. This makes routine information and urgent problems look equally important.

The Home page should prioritise:

1. Needs attention
2. Today
3. Quick actions
4. Records and compliance summaries

Cards with a zero value should be visually quieter. Items requiring action should include a direct verb, such as Review 3 missing clock-outs, instead of only displaying a number and Live badge.

## Visual UI Findings

The current typography, contrast and touch-target sizes are generally suitable. The main visual problems come from density and repetition.

Recommended visual changes:

- use compact rows for staff and device lists instead of a large card per item
- use cards only for genuine summary items and forms
- reserve purple for navigation, primary actions and focus states
- use neutral surfaces for ordinary information
- keep green, amber and red for meaningful status
- reduce repeated Production badges and technical status labels
- keep page titles and controls smaller and denser on operational screens
- use 8 px or smaller card corner radii for a more work-focused interface
- keep the primary action visible in the first mobile viewport
- paginate long history tables and staff lists

## Production Priorities

### Critical before production

1. Rename the navigation and remove technical wording.
2. Consolidate employee management into Staff records.
3. Put clocking-in access and PINs on the employee record.
4. Split Attendance into task-based views.
5. Make renamed staff appear consistently on Staff Clock after save.
6. Add search and Needs setup filtering to long staff lists.
7. Keep all pay details manager-only.

### High-value polish

1. Replace equal Dashboard cards with a Needs attention list.
2. Group risky rota tools under More.
3. Simplify attendance decision wording and forms.
4. Move the workbook import behind an advanced Pay details action.
5. Add pagination to clocking history.

### Later improvements

1. WhatsApp leave request intake using the existing approval workflow.
2. Optional shift and availability replies through a dedicated WhatsApp number.
3. Additional guided setup for rarely used production settings.

## Acceptance Criteria

The redesign is successful when:

- a manager can add an employee and enable clocking in without changing main-menu sections
- the field controlling the Staff Clock name is obvious
- saving a name refreshes affected screens and the Staff Clock roster
- any employee can be found by search without scrolling through the whole staff list
- attendance corrections are reachable without scrolling past all daily review cards
- clocking history is searchable or paginated
- the main navigation contains no Supabase or database terminology
- each pay-related destination has a clearly different purpose
- the first mobile viewport shows the page purpose and primary action
- public Staff Clock screens expose no pay or private manager information
- original clock events remain immutable and manager corrections remain separate

## Recommended Delivery Order

1. Wording, navigation labels and technical-copy cleanup.
2. Staff directory and employee record navigation.
3. Clocking-in controls moved into the employee record.
4. Attendance tabs and paginated clocking history.
5. Pay menu consolidation.
6. Home and rota action hierarchy.
7. Full desktop and mobile workflow verification.

This order delivers immediate clarity first, then removes the structural causes of the scrolling problem without replacing working business logic.
