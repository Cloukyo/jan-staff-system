import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AttendanceCorrectionControls,
  type CorrectionFormAction,
} from "@/components/attendance/attendance-correction-controls";
import type { StaffHoursDay } from "@/lib/attendance/staff-hours";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mocks.replace,
    refresh: mocks.refresh,
  }),
}));

function attendanceDay(overrides: Partial<StaffHoursDay> = {}): StaffHoursDay {
  return {
    staffId: "staff-1",
    displayName: "Aisha",
    fullName: "Aisha Khan",
    date: "2026-07-28",
    eventRevision: "events:event-1|corrections:",
    plannedPeriods: [
      { id: "shift-1", startTime: "09:00", endTime: "17:00", breakMinutes: 0 },
    ],
    audit: { originals: [], corrections: [] },
    effectiveEvents: [
      {
        id: "10000000-0000-4000-8000-000000000000",
        staffId: "staff-1",
        eventType: "clock_in",
        eventTimestamp: "2026-07-28T08:00:00.000Z",
        recordedDate: "2026-07-28",
        source: "kiosk",
        originalEventId: "10000000-0000-4000-8000-000000000000",
        correctionId: null,
      },
    ],
    sessions: [],
    completedMinutes: 0,
    hasOpenShift: true,
    warnings: ["missing_clock_out"],
    suggestedMissingType: "clock_out",
    review: null,
    ...overrides,
  };
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.includes(text));
  if (!button) throw new Error(`Missing button: ${text}`);
  return button;
}

function enterValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("attendance removal and reset forms", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it.each([
    { buttonText: "Remove from hours", reason: "Duplicate kiosk tap" },
    { buttonText: "Reset to planned hours", reason: "Return to published rota" },
  ])("retains the reason after $buttonText returns an error", async ({
    buttonText,
    reason,
  }) => {
    const failingAction = vi.fn<CorrectionFormAction>(async () => ({
      ok: false,
      code: "save_failed",
      message: "The change could not be saved.",
    }));
    await act(async () => {
      root.render(
        <AttendanceCorrectionControls
          day={attendanceDay()}
          correctionId="40000000-0000-4000-8000-000000000000"
          returnTo="/attendance?view=hours"
          manualAction={failingAction}
          removeAction={failingAction}
          resetAction={failingAction}
        />,
      );
    });
    const submitButton = buttonByText(container, buttonText);
    const form = submitButton.closest("form");
    if (!form) throw new Error(`Missing form for ${buttonText}`);
    const reasonInput = form.elements.namedItem("reason") as HTMLInputElement;
    const confirmation = form.elements.namedItem("confirmed") as HTMLInputElement;
    await act(async () => {
      enterValue(reasonInput, reason);
      confirmation.click();
    });

    await act(async () => {
      form.requestSubmit(submitButton);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(failingAction).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="status"]')?.textContent)
      .toBe("The change could not be saved.");
    expect(reasonInput.value).toBe(reason);
  });

  it("names the staff member and UK attendance date in reset confirmation", async () => {
    const action = vi.fn<CorrectionFormAction>();
    await act(async () => {
      root.render(
        <AttendanceCorrectionControls
          day={attendanceDay()}
          correctionId="40000000-0000-4000-8000-000000000000"
          returnTo="/attendance?view=hours"
          manualAction={action}
          removeAction={action}
          resetAction={action}
        />,
      );
    });
    const resetForm = buttonByText(container, "Reset to planned hours").closest("form");

    expect(resetForm?.textContent).toContain(
      "Aisha Khan",
    );
    expect(resetForm?.textContent).toContain(
      "28/07/2026",
    );
  });

  it("directs the manager to correct a clock-change rota boundary", async () => {
    const action = vi.fn<CorrectionFormAction>();
    await act(async () => {
      root.render(
        <AttendanceCorrectionControls
          day={attendanceDay({
            date: "2026-03-29",
            plannedPeriods: [
              { id: "shift-1", startTime: "01:30", endTime: "03:30", breakMinutes: 0 },
            ],
          })}
          correctionId="40000000-0000-4000-8000-000000000000"
          returnTo="/attendance?view=hours"
          manualAction={action}
          removeAction={action}
          resetAction={action}
        />,
      );
    });

    expect(container.textContent).toContain(
      "Correct the published rota time before resetting attendance.",
    );
    expect([...container.querySelectorAll("button")]
      .some((button) => button.textContent?.includes("Reset to planned hours")))
      .toBe(false);
  });
});
