# Unreviewed Payroll Excel Export Design

## Purpose

Allow a manager to export payroll-preparation hours to Excel even when attendance reviews or staff correction requests are incomplete. The export is a working file for manual checking, not an approval action or completed payroll.

## User workflow

1. The manager selects the payroll period and export filters.
2. The **Export Excel** button remains available regardless of review readiness.
3. If every worked day is reviewed and no correction requests are open, the workbook downloads normally.
4. If reviews are incomplete, the page shows an inline confirmation panel containing:
   - the number of unreviewed worked days;
   - the number of open staff correction requests;
   - a warning that exported hours may be inaccurate and must be checked manually.
5. The manager selects **Export unreviewed Excel** to confirm and download the workbook.

Closing or cancelling the confirmation does not change attendance data or review status.

## Server-side safeguard

The export route continues to calculate review readiness independently. An incomplete export is allowed only when the request includes an explicit confirmation value. Direct requests without that confirmation continue to receive a conflict response.

Manager authentication remains mandatory. No salary or pay-rate information is exposed outside the manager-only payroll workflow.

## Workbook labelling

An incomplete workbook is clearly labelled **UNREVIEWED PAYROLL PREPARATION**. It includes the selected UK-formatted date range, the counts of unreviewed days and open correction requests, and the existing per-staff review status and warnings.

A fully reviewed workbook keeps its normal payroll-preparation label. Neither workbook is described as a payslip or completed payroll.

## Data integrity

- Original clock events remain immutable.
- Existing manager corrections remain separate from original clock events.
- Exporting does not approve attendance or close staff correction requests.
- Exporting does not alter historic pay arrangements.
- The workbook uses the same calculated preparation rows shown in the manager preview.
- No tax, PAYE, National Insurance, pension or payslip calculations are added.

## Error handling

- Invalid date ranges continue to return a validation error.
- Incomplete exports without explicit confirmation continue to return a conflict response.
- Export generation failures return an error and do not change attendance or review records.

## Testing

Automated tests will verify:

- the export control is enabled when reviews are incomplete;
- incomplete export requires explicit confirmation;
- confirmed incomplete export creates an Excel workbook;
- incomplete workbooks contain the unreviewed label and readiness counts;
- reviewed exports continue to work without confirmation;
- manager access remains required;
- exporting does not mutate attendance or review records.

The completed change must pass lint, TypeScript checking, the full Vitest suite and the production build. The manager interaction will also be checked in the rendered application.
