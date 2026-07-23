# Weekly Payroll Hours Worksheets Design

## Goal

Make the payroll Excel export easy to review week by week. Each selected UK calendar week will have its own worksheet showing every included employee's planned and raw clocked hours by day, with visible weekly totals.

## Workbook Structure

The workbook worksheets will be ordered as:

1. `Pay Summary`
2. `Week 1`
3. `Week 2`
4. Additional numbered week worksheets when required
5. `Daily Clocking`
6. `Read Me`

The current `Payroll Preparation` worksheet will be renamed `Pay Summary`. The separate `Planned Rota` worksheet will be removed because its planned hours will be included in every weekly worksheet.

The manager-only permission, unreviewed-export confirmation and unreviewed-workbook labelling remain unchanged.

## Week Boundaries

- Weeks follow the UK Monday-to-Sunday calendar.
- The selected export period remains inclusive.
- If the period starts after Monday, `Week 1` contains the partial week from the selected start date to Sunday.
- If the period ends before Sunday, the final worksheet contains the partial week ending on the selected end date.
- A period of seven days or fewer still creates `Week 1`.
- Longer periods create `Week 2`, `Week 3` and so on in chronological order.
- Worksheet numbering is based on the selected period, not the calendar week number.

For example, 1 to 31 July 2026 creates:

- `Week 1`: Wednesday 1 July to Sunday 5 July
- `Week 2`: Monday 6 July to Sunday 12 July
- `Week 3`: Monday 13 July to Sunday 19 July
- `Week 4`: Monday 20 July to Sunday 26 July
- `Week 5`: Monday 27 July to Friday 31 July

## Weekly Worksheet Layout

Each weekly worksheet contains:

- `Staff name`
- `Role`
- `Hours type`
- one column for each selected date in that week
- `Weekly total`

Date headers use UK display formatting with the weekday, for example `Mon 06/07`.

Every included employee has two adjacent rows:

1. `Planned hours`
2. `Clocked hours`

The employee's name and role cells are merged vertically across the two rows. Planned and clocked hour cells are numeric decimal hours with two decimal places.

The header rows and the first three columns are frozen. Weekly sheets use landscape page setup and fit to one printed page wide.

## Planned Hours

- Planned hours use non-cancelled, non-archived rota shifts within that date.
- Future rota shifts are included.
- Planned minutes equal the scheduled duration less the planned break.
- Multiple valid shifts for the same employee and date are summed.
- Overnight rota shifts treat the finish as the following day.
- No rota shift produces `0.00`.

## Clocked Hours

- Clocked hours use original clock events where `manager_correction` is false.
- Events are grouped by employee and recorded date.
- Events are ordered chronologically.
- Each clock-in is paired with its following clock-out.
- The completed session durations for that date are summed.
- A clocked-out break is unpaid because the break falls between two completed sessions and is not included.
- Manager correction events are not added to the weekly raw clocked-hours rows.
- An unmatched clock-in or clock-out does not create invented time. Complete sessions still contribute, and the existing `Daily Clocking` worksheet shows the warning and audit detail.

This is the same raw-session calculation used by the existing payroll preparation logic.

## Weekly Totals

- Every `Planned hours` row has a total across that week's date cells.
- Every `Clocked hours` row has a separate total across that week's date cells.
- Totals are written as Excel formulas so manual changes to daily hours update the weekly total.
- Each formula also contains the calculated result from export time so the total displays immediately in spreadsheet viewers that do not recalculate formulas.
- The workbook requests a full recalculation when opened in Excel.
- A partial week's total includes only dates inside the selected export period.

## Existing Worksheets

### Pay Summary

The existing staff pay-preparation summary remains unchanged apart from the worksheet name. It continues to show raw, reviewed, ordinary and overtime hours, pay arrangements, estimated gross values, review status and warnings.

### Daily Clocking

The existing audit worksheet remains unchanged. It continues to separate original clock events from manager correction events and show review reasons and warnings.

### Read Me

The existing review warnings and payroll-preparation disclaimer remain. A short note explains:

- each numbered worksheet is a Monday-to-Sunday week;
- planned hours deduct planned rota breaks;
- clocked hours sum original completed clock-in/out sessions; and
- clocked-out breaks are unpaid.

## Staff Filtering

The existing export choices continue to determine which employees appear:

- include inactive;
- include manager profile; and
- include zero hours.

The same included employees appear on `Pay Summary` and every numbered weekly worksheet.

## Error Handling

- Invalid periods retain the existing validation response.
- Rota or attendance query failures prevent the export instead of silently omitting hours.
- Missing rota produces zero planned hours.
- Missing or incomplete clock pairs produce zero for the incomplete session and remain visible as warnings in `Daily Clocking`.
- No original clock events produces zero clocked hours.

## Testing

Automated tests will verify:

- a midweek month start creates the correct partial `Week 1`;
- a multiweek period creates correctly ordered numbered worksheets;
- each employee has planned and clocked sub-rows;
- weekly date columns contain only the appropriate dates;
- planned breaks are deducted;
- completed clock sessions are summed and clocked-out breaks are excluded;
- manager correction events do not affect raw weekly clocked hours;
- weekly planned and clocked totals have both formulas and cached numeric results;
- formula totals recalculate from the correct date-cell range;
- `Payroll Preparation` is renamed `Pay Summary`;
- `Planned Rota` is removed;
- `Daily Clocking` and `Read Me` remain present;
- UK date formatting, frozen panes and number formats are applied.

Full lint, type checking, tests and production build will run before deployment. A generated workbook and a live production download will be inspected after deployment.

## Out of Scope

- Editing rota or attendance from Excel.
- Importing workbook changes into the staff system.
- Treating manager corrections as raw clock events.
- Inventing unpaid break time when no clock-out occurred.
- Tax, PAYE, National Insurance, pension or payslip calculations.
