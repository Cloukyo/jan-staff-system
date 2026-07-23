# Payroll Export Hours Selection Design

## Goal

Let a manager choose whether a payroll Excel export contains planned hours, clocked
hours, or both. This makes it possible to generate a clean rota-based workbook for
calculating pay before the month has finished.

## Export choices

The pay preparation screen will show an **Hours to include** selector with three
choices:

1. **Both planned and clocked**: the current full workbook and the default choice.
2. **Planned hours only**: weekly planned-hours worksheets and `Read Me`.
3. **Clocked hours only**: weekly clocked-hours worksheets, `Pay Summary`,
   `Daily Clocking`, and `Read Me`.

Using a single selector prevents the invalid state that two independent checkboxes
would allow and avoids cluttering the page with multiple export buttons.

## Workbook layouts

Every numbered weekly worksheet will keep employees as rows, dates as columns, and a
weekly total column.

- In **both** mode, each employee has a planned-hours subrow and a clocked-hours
  subrow.
- In **planned** mode, each employee has one planned-hours row.
- In **clocked** mode, each employee has one clocked-hours row.

When a weekly worksheet has only one hours type, the separate `Hours type` column is
omitted because every row has the same meaning. Employee names and roles remain
visible on each row. Weekly total cells retain their formula and cached result so
they display immediately in viewers that do not recalculate.

The `Read Me` worksheet will state which hours were included and how they were
calculated.

## Request and validation

The screen will send an `hours` query parameter with one of:

- `both`
- `planned`
- `clocked`

The export route will parse this value through a small typed helper. Missing or
unrecognised values will fall back to `both`, preserving existing bookmarks and
requests.

The unreviewed-attendance confirmation remains mandatory for `both` and `clocked`
exports. A `planned` export does not contain attendance-derived hours and therefore
does not require the unreviewed-attendance confirmation.

## Existing behaviour

The default remains the current full workbook. Existing filtering for dates,
inactive staff, manager profiles, and zero hours remains unchanged.

Original clock events and manager corrections remain unchanged. Clocked weekly
hours continue to use original completed clock-in/out sessions and exclude
clocked-out breaks.

## Testing

Automated tests will verify:

- the selector offers all three choices and passes the selected value to the export;
- missing and invalid parameters fall back to `both`;
- planned-only exports contain weekly planned rows and `Read Me`, but omit
  `Pay Summary` and `Daily Clocking`;
- clocked-only exports contain weekly clocked rows, `Pay Summary`,
  `Daily Clocking`, and `Read Me`;
- both-mode exports preserve the current two-subrow weekly layout;
- planned-only exports bypass the unreviewed-attendance confirmation, while modes
  containing clocked hours still require it;
- weekly formulas and cached totals remain correct in every mode.

The full lint, type-check, test, and production-build commands will run before
deployment.
