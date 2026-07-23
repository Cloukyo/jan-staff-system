# Weekly Hourly Pay Columns Design

## Goal

Add editable hourly pay and formula-driven estimated pay columns to every numbered
weekly payroll export worksheet.

## Weekly columns

Every `Week` worksheet will end with these columns:

1. `Weekly total`
2. `Hourly pay`
3. `Estimated pay`

The hourly pay value will come from the same effective Manage pay arrangement already
used by the pay preparation row and `Pay Summary`. It will be stored as a numeric
currency value so the manager can overwrite it directly in Excel.

If the staff member has no hourly rate, or has a salaried pay arrangement, `Hourly
pay` will be blank. The blank cell will remain editable.

## Formulas

`Estimated pay` will be a live Excel formula:

```excel
=IF(hourly_pay_cell="","",weekly_total_cell*hourly_pay_cell)
```

The exported cell will contain both the formula and an export-time cached result.
When the hourly pay cell is blank, the cached result will also be blank. When the
manager types or changes an hourly rate, Excel will recalculate the estimated pay.

The estimate is a simple multiplication of decimal weekly hours by the hourly rate.
It will not apply overtime multipliers or calculate tax, PAYE, National Insurance,
pensions, student loans, statutory deductions or payslips.

## Export modes

### Planned hours only

Each staff row will contain one hourly pay cell and one estimated pay formula based on
the planned weekly total.

### Clocked hours only

Each staff row will contain one hourly pay cell and one estimated pay formula based on
the clocked weekly total.

### Both planned and clocked

The hourly pay cell will be vertically merged across the employee's planned and
clocked subrows so there is one editable rate for the employee in that week.

Each subrow will have its own estimated pay formula:

- planned weekly total multiplied by hourly pay;
- clocked weekly total multiplied by hourly pay.

## Formatting and workbook guidance

`Hourly pay` and `Estimated pay` will use UK pound currency formatting with two
decimal places. Weekly totals remain decimal hours with two decimal places.

The weekly note and `Read Me` worksheet will explain that estimated pay is an
editable preparation figure and not completed payroll.

## Testing

Automated workbook tests will verify:

- all three export modes include the two new columns;
- hourly rates are populated from Manage pay when present;
- missing and salaried hourly rates remain blank;
- combined exports merge the hourly pay cell across the two subrows;
- planned and clocked estimated pay formulas reference the correct weekly total and
  hourly pay cells;
- formulas contain cached numeric results when a rate exists and blank results when
  it does not;
- currency and decimal-hour number formats are correct;
- editing the hourly pay input is supported by a formula rather than a static pay
  value.

The complete lint, type-check, test and production-build commands will run before
deployment. Generated workbooks and real production downloads will be inspected and
rendered before completion is reported.
