# Rota Copy Hours Design

## Goal

Make repetitive rota entry easier for a manager by adding copy controls to the existing shift editor. The workflow must work on desktop and mobile, use large accessible controls, and clearly confirm any action that replaces or removes existing shifts.

## Scope

The shift editor will provide two actions:

1. **Copy previous day** copies the selected staff member's working pattern from the preceding day into the day currently being edited.
2. **Copy to other days** copies the current shift's hours to one or more later days in the same rota week.

Only the start time, finish time, and break duration or unspecified-break state are copied. Room, role, notes, status, and manager override reasons are not copied.

## Copy Previous Day

- The control appears in both the Add shift and Edit shift versions of the drawer.
- It is unavailable on Monday because the previous day is outside the displayed rota week.
- If the previous day contains one active shift, its start time, finish time, and break values replace the selected day's working pattern.
- If the previous day contains no active shift, the selected day becomes not working. Any active shift or shifts on the selected day are archived only after the manager confirms the removal.
- If the previous day contains multiple active shifts, all of them are copied so split-shift working patterns remain intact. A "Not working" state is not inferred when shifts exist.
- Copying into a day that already has active shifts requires confirmation and archives those shifts before creating the copied shift.
- The result message states whether hours were copied or the day was changed to not working.

## Copy to Other Days

- The control appears when editing an existing shift.
- It shows checkboxes for later days in the same rota week. The source day and earlier days are not selectable.
- The manager can select one or more target days and sees a confirmation explaining that existing shifts on those days will be replaced.
- For each selected day, active shifts are archived and a new scheduled shift is created using the source shift's start time, finish time, and break values.
- The current shift and source day remain unchanged.
- Room, role, notes, status, and override reasons on the source shift are not copied. New target shifts use no room, role, notes, or override reasons and use the `scheduled` status.
- The result states how many days were updated.

## Data and Safety

- Copy operations are manager-only server actions.
- Existing records are archived rather than deleted, preserving rota history.
- Each bulk operation validates that the source and all targets belong to the same draft rota week.
- Database changes for one copy operation are atomic so a failure cannot leave only part of the requested week updated.
- Approved leave, inactive staff, and overlapping-shift protections continue to apply. When a copied shift needs an override, the action returns the existing clear validation message rather than silently bypassing the rule.
- Copy controls do not expose pay or salary information.

## User Interface

- Add a clearly labelled "Copy hours" section above the shift form buttons.
- "Copy previous day" includes the previous weekday in its label or supporting text.
- "Copy to other days" expands a compact set of weekday checkboxes with large labels and touch targets.
- Replacement and not-working confirmations name the affected staff member and dates using UK formatting.
- Successful actions close the drawer and refresh the rota grid.

## Error Handling

- If the source shift no longer exists, show that it could not be found and leave the rota unchanged.
- If the rota is no longer a draft, explain that copying is only available for draft rotas.
- If no target day is selected, keep the form open and ask the manager to choose at least one day.
- If validation or a database operation fails, show a concise message and make no partial changes.

## Testing

- Unit-test selection and request parsing, including Monday, empty previous days, multiple previous shifts, and multiple target days.
- Action-level tests cover manager permissions, draft-week checks, archive-and-create behaviour, no-partial-change behaviour, and validation failures.
- Interface tests verify both copy controls, accessible labels, UK-formatted confirmation copy, and large checkbox targets.
- Run lint, TypeScript checks, Vitest, and the production build.

## Out of Scope

- Copying shifts between different weeks.
- Copying room, role, notes, status, or override reasons.
- Changing historic published or archived rota weeks.
- Creating a separate bulk rota editor.
