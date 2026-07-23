# Payroll Workbook Rota and Daily Detail Design

## Goal

Extend the manager-only payroll Excel export so it contains the information needed to prepare pay before a month has finished:

- planned rota hours for the full selected period, including future shifts; and
- an auditable day-by-day breakdown of original clock events and manager correction events.

The export remains payroll preparation only. It does not calculate PAYE, National Insurance, pensions or payslips.

## Workbook Structure

The workbook will contain four worksheets:

1. `Payroll Preparation`
2. `Planned Rota`
3. `Daily Clocking`
4. `Read Me`

The existing `Payroll Preparation` and `Read Me` behaviour remains, including the prominent unreviewed-workbook warning and attendance readiness counts.

## Planned Rota Worksheet

### Purpose

Give the manager a single monthly-style view of the hours each staff member is planned to work, including future shifts that do not yet have clock events.

### Layout

- One row per included staff member.
- The first columns contain staff name and role.
- One column is created for every calendar date in the selected export period.
- Date headings use UK display formatting and include the weekday.
- Each date cell contains planned net decimal hours for that staff member on that date.
- The final column contains `Total planned hours`.
- The header row and staff identity columns are frozen.
- Date columns and the total column use two-decimal number formatting.
- The table is filterable and readable when opened in Excel.

### Planned Hours Rules

- Read rota shifts whose dates fall inside the selected export period.
- Include future shifts.
- Include scheduled and completed shifts from non-archived rota weeks.
- Exclude cancelled and archived shifts.
- Planned net minutes equal the time from scheduled start to scheduled end, less the planned break.
- If a shift crosses midnight, its end is treated as the following day.
- Multiple valid shifts for the same staff member and date are summed.
- A date with no valid rota shift contains zero hours.
- The total is an Excel formula summing that staff member's visible date cells.
- A note explains that these are planned rota hours and may differ from clocked or corrected attendance.

The staff filters used by the existing export also apply to this worksheet: active/inactive, manager profile and zero-hours choices.

## Daily Clocking Worksheet

### Purpose

Provide a day-by-day audit trail that lets the manager compare rota expectations, original kiosk records and later manager corrections without changing the source data.

### Rows and Columns

There is one row per included staff member per relevant date. A date is relevant when it contains a rota shift, an original clock event, a manager correction event or an attendance review.

Columns are:

- Staff name
- Role
- Date
- Planned start
- Planned finish
- Planned break minutes
- Planned net hours
- Original clock-ins
- Original clock-outs
- Manager correction clock-ins
- Manager correction clock-outs
- Raw worked hours
- Worked hours including manager corrections
- Attendance review status
- Review or correction reason
- Warnings

If more than one event of a type occurs, all times are shown in chronological order in the same cell, separated clearly. Times use Europe/London and UK `HH:mm` display. Dates are stored as dates and displayed in UK format.

### Audit Rules

- Original clock event rows are never modified.
- Original event columns contain only events where `manager_correction` is false.
- Manager correction columns contain only events where `manager_correction` is true.
- Raw worked hours are calculated from original events only.
- Worked hours including manager corrections use the same event-pairing rules as the existing payroll preparation calculation.
- Review status and reason come from the existing attendance day review record.
- Warnings include missing clock-out, clock-out without clock-in, overlapping sessions, unusually long shifts, manager correction and incomplete review where applicable.
- Future rota dates with no clock events remain visible with blank clock columns and zero worked hours.

The worksheet does not present correction events as if they were original kiosk records.

## Data Loading

The payroll export route will load, in parallel:

- staff and pay arrangements;
- clock events for the selected period;
- attendance reviews and readiness;
- rota shifts for the selected period.

A period-based rota loader will query all non-archived rota weeks and their non-archived shifts that overlap the selected dates. The loader will return only the fields needed by the workbook and will preserve the current weekly rota loaders unchanged.

The existing export authorisation remains manager-only. The existing explicit confirmation is still required when attendance is incomplete.

## Error Handling

- Invalid date ranges continue to return the existing validation error.
- A rota query failure prevents the export and reports that production rota data could not be loaded. The workbook must not silently omit planned hours.
- A valid period with no rota shifts still exports with zero planned hours and any available clocking detail.
- Missing or incomplete event pairs remain visible and produce warnings rather than invented times.

## Testing

Automated tests will verify:

- future rota shifts are included;
- cancelled and archived shifts are excluded;
- planned breaks are deducted;
- overnight and multiple same-day shifts are calculated correctly;
- the `Planned Rota` worksheet has one date column per selected date and formula totals;
- the `Daily Clocking` worksheet separates original and manager correction events;
- daily rows include future rota-only dates;
- raw and correction-inclusive hours match existing payroll calculation rules;
- UK date/time and decimal-hour formatting is applied;
- the route loads and passes rota data into the workbook;
- the existing unreviewed confirmation policy remains enforced.

Full lint, type checking, tests and production build will run before deployment. A generated workbook will be opened programmatically to inspect worksheet names, key cells, formulas and formatting.

## Out of Scope

- Editing rota or attendance from Excel.
- Importing the corrected workbook back into the staff system.
- Tax, PAYE, National Insurance, pension or payslip calculations.
- A separate worksheet for every staff member.
- Changing the browser payroll preview table.
