import type {
  AttendanceReviewRow,
  AttendanceReviewStatus,
} from "@/lib/attendance/review-server";
import type { SemanticTone } from "@/components/ui/semantic-primitives";

export type AttendancePriorityInput = Pick<
  AttendanceReviewRow,
  "staffId" | "reviewStatus" | "exceptions" | "pendingClarificationCount"
>;

export type AttendanceActionKind =
  | "correction"
  | "follow_up"
  | "review"
  | "complete";

export type AttendanceActionPresentation = {
  kind: AttendanceActionKind;
  tone: SemanticTone;
  label: string;
  description: string;
};

const priority: Record<AttendanceActionKind, number> = {
  correction: 0,
  follow_up: 1,
  review: 2,
  complete: 3,
};

function completedDescription(status: AttendanceReviewStatus): string {
  switch (status) {
    case "approved":
      return "Recorded time has been approved.";
    case "corrected":
      return "Corrected time has been reviewed.";
    case "ignored":
      return "The exception was accepted with a reason.";
    case "needs_staff_clarification":
      return "The record is waiting for staff follow-up.";
    case "unreviewed":
      return "This record has not been reviewed.";
  }
}

export function classifyAttendanceReviewRow(
  row: AttendancePriorityInput,
): AttendanceActionPresentation {
  if (row.exceptions.length > 0) {
    return {
      kind: "correction",
      tone: "blocking",
      label: "Fix recorded time",
      description: row.exceptions.join("; "),
    };
  }
  if (
    row.pendingClarificationCount > 0
    || row.reviewStatus === "needs_staff_clarification"
  ) {
    return {
      kind: "follow_up",
      tone: "attention",
      label: "Staff follow-up needed",
      description: row.pendingClarificationCount > 0
        ? `${row.pendingClarificationCount} staff request${row.pendingClarificationCount === 1 ? "" : "s"} waiting for a manager response.`
        : "This record is marked for staff clarification.",
    };
  }
  if (row.reviewStatus === "unreviewed") {
    return {
      kind: "review",
      tone: "attention",
      label: "Ready for review",
      description: "Check the recorded time and save a decision.",
    };
  }
  return {
    kind: "complete",
    tone: "success",
    label: "Reviewed",
    description: completedDescription(row.reviewStatus),
  };
}

export function buildAttendanceActionQueue<T extends AttendancePriorityInput>(rows: T[]) {
  const classified = rows.map((row, index) => ({
    row,
    presentation: classifyAttendanceReviewRow(row),
    index,
  }));
  classified.sort((left, right) => (
    priority[left.presentation.kind] - priority[right.presentation.kind]
    || left.index - right.index
  ));

  const correction = classified.filter(({ presentation }) => presentation.kind === "correction").length;
  const followUp = classified.filter(({ presentation }) => presentation.kind === "follow_up").length;
  const review = classified.filter(({ presentation }) => presentation.kind === "review").length;
  const complete = classified.filter(({ presentation }) => presentation.kind === "complete").length;

  return {
    rows: classified.map(({ row, presentation }) => ({ row, presentation })),
    counts: {
      correction,
      followUp,
      review,
      complete,
      actionRequired: correction + followUp + review,
      total: classified.length,
    },
  };
}
