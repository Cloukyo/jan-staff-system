import { addDays, addWeeks, format, startOfWeek } from "date-fns";
import type { ClockEvent, DemoState, PayRateHistory, RotaShift, StaffMember } from "@/types";
import { prototypeHashPin } from "@/lib/pin/service";

const now = "2026-06-08T08:00:00+01:00";

function pence(value: number): number {
  return Math.round(value * 100);
}

function id(prefix: string, index: number): string {
  return `${prefix}-${index.toString().padStart(3, "0")}`;
}

function iso(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function at(date: string, time: string): string {
  return `${date}T${time}:00+01:00`;
}

const staffSeed: StaffMember[] = [
  ["stf-001", "Amelia Brooks", "Amelia", "Manager", "salaried", null, pence(3250), 40 * 60, 30, true, "2468"],
  ["stf-002", "Priya Shah", "Priya", "Deputy Manager", "salaried", null, pence(2850), 38 * 60, 30, true, "1357"],
  ["stf-003", "Hannah Clarke", "Hannah", "Room Leader", "hourly", pence(14.75), null, 36 * 60, 30, true, "1122"],
  ["stf-004", "Maya Patel", "Maya", "Nursery Practitioner", "hourly", pence(12.6), null, 30 * 60, 30, true, "3344"],
  ["stf-005", "Sophie Martin", "Sophie", "Nursery Practitioner", "hourly", pence(12.25), null, 24 * 60, 30, true, "5566"],
  ["stf-006", "Leah Williams", "Leah", "Apprentice", "hourly", pence(8.9), null, 32 * 60, 45, true, "7788"],
  ["stf-007", "Grace Evans", "Grace", "Room Leader", "hourly", pence(14.2), null, 35 * 60, 30, true, "9090"],
  ["stf-008", "Nadia Khan", "Nadia", "Nursery Practitioner", "hourly", pence(12.8), null, 20 * 60, 30, true, "1212"],
  ["stf-009", "Olivia Reed", "Olivia", "Administrator", "salaried", null, pence(2100), 30 * 60, 0, true, "3434"],
  ["stf-010", "Emily Turner", "Emily", "Nursery Practitioner", "hourly", pence(11.95), null, 18 * 60, 30, true, "5656"],
  ["stf-011", "Zara Ahmed", "Zara", "Nursery Practitioner", "hourly", pence(12.1), null, 25 * 60, 30, true, "7878"],
  ["stf-012", "Rebecca Jones", "Rebecca", "Former Practitioner", "hourly", pence(11.5), null, 0, 30, false, "9999"],
].map(([staffId, fullName, displayName, role, payType, hourlyRatePence, monthlySalaryPence, contractedWeeklyMinutes, defaultBreakMinutes, active, pin]) => ({
  id: staffId as string,
  fullName: fullName as string,
  displayName: displayName as string,
  role: role as string,
  employmentStatus: active ? "employed" : "former",
  payType: payType as "hourly" | "salaried",
  hourlyRatePence: hourlyRatePence as number | null,
  monthlySalaryPence: monthlySalaryPence as number | null,
  contractedWeeklyMinutes: contractedWeeklyMinutes as number,
  defaultBreakMinutes: defaultBreakMinutes as number,
  startDate: active ? "2024-09-02" : "2023-04-17",
  endDate: active ? null : "2026-05-31",
  active: active as boolean,
  pinHash: prototypeHashPin(pin as string),
  pinIsTemporary: ["stf-006", "stf-011"].includes(staffId as string),
  failedPinAttempts: 0,
  lockedUntil: null,
  createdAt: now,
  updatedAt: now,
}));

function buildRota(): RotaShift[] {
  const monday = startOfWeek(new Date("2026-06-08T12:00:00+01:00"), { weekStartsOn: 1 });
  const rows: RotaShift[] = [];
  let count = 1;
  const staff = staffSeed.filter((person) => person.active);

  for (let week = -2; week <= 1; week += 1) {
    for (const person of staff) {
      for (let day = 0; day < 5; day += 1) {
        const date = iso(addDays(addWeeks(monday, week), day));
        let status: RotaShift["status"] = "working";
        let scheduledStart: string | null = "08:30";
        let scheduledEnd: string | null = "16:30";
        if (person.id === "stf-009") {
          scheduledStart = "09:00";
          scheduledEnd = "15:00";
        }
        if (person.id === "stf-010" && day > 2) status = "off";
        if (person.id === "stf-008" && ![1, 3].includes(day)) status = "off";
        if (person.id === "stf-005" && day === 4) status = "off";
        if (week === 0 && person.id === "stf-004" && day === 2) status = "holiday";
        if (week === 0 && person.id === "stf-007" && day === 1) status = "sick";
        if (week === 0 && person.id === "stf-003" && day === 3) status = "training";
        if (status !== "working") {
          scheduledStart = null;
          scheduledEnd = null;
        }
        const creditedMinutes = status === "holiday" || status === "training" ? 7 * 60 + 30 : status === "sick" ? 0 : undefined;
        const payTreatment = status === "holiday" || status === "training" ? "paid" : status === "sick" ? "unpaid" : undefined;
        rows.push({
          id: id("rot", count++),
          staffId: person.id,
          date,
          scheduledStart,
          scheduledEnd,
          status,
          plannedBreakMinutes: person.defaultBreakMinutes,
          payTreatment,
          creditedMinutes,
          payableMinutes: payTreatment === "paid" ? creditedMinutes : 0,
          managerNote: status === "sick" ? "Unpaid sickness in demo data" : undefined,
          roomOrRole: person.role.includes("Leader") ? "Preschool room" : person.role.includes("Manager") ? "Office cover" : "Nursery floor",
          notes: status === "training" ? "Safeguarding refresher" : undefined,
        });
      }
    }
  }
  return rows;
}

function buildClockEvents(): ClockEvent[] {
  const monday = startOfWeek(new Date("2026-06-08T12:00:00+01:00"), { weekStartsOn: 1 });
  const events: ClockEvent[] = [];
  let count = 1;
  const push = (staffId: string, date: string, type: ClockEvent["type"], time: string) =>
    events.push({ id: id("clk", count++), staffId, timestamp: at(date, time), type, source: "kiosk", createdAt: at(date, time) });

  for (let week = -1; week <= 0; week += 1) {
    for (let day = 0; day < 5; day += 1) {
      const date = iso(addDays(addWeeks(monday, week), day));
      push("stf-001", date, "clock_in", "08:20");
      push("stf-001", date, "break_start", "12:30");
      push("stf-001", date, "break_end", "13:00");
      if (!(day === 0 && week === 0)) push("stf-001", date, "clock_out", "16:40");
      push("stf-002", date, "clock_in", "08:25");
      if (day === 0 && week === 0) {
        push("stf-002", date, "break_start", "12:35");
      } else {
        push("stf-002", date, "clock_out", "16:30");
      }
      push("stf-003", date, "clock_in", day === 0 && week === 0 ? "09:05" : "08:28");
      push("stf-003", date, "break_start", "12:10");
      push("stf-003", date, "break_end", "12:40");
      if (!(day === 2 && week === 0)) push("stf-003", date, "clock_out", day === 4 && week === -1 ? "18:10" : "16:32");
      if (day !== 2) {
        push("stf-004", date, "clock_in", "08:35");
        push("stf-004", date, "clock_out", day === 1 && week === 0 ? "15:25" : "16:30");
      }
      if (day < 4) {
        push("stf-006", date, "clock_in", "08:45");
        push("stf-006", date, "break_start", "12:00");
        push("stf-006", date, "break_end", "12:45");
        push("stf-006", date, "clock_out", "16:45");
      }
    }
  }
  const unscheduled = iso(addDays(monday, 4));
  push("stf-008", unscheduled, "clock_in", "09:10");
  push("stf-008", unscheduled, "clock_out", "13:00");
  const duplicate = iso(addDays(monday, 0));
  push("stf-005", duplicate, "clock_in", "08:31");
  push("stf-005", duplicate, "clock_in", "08:32");
  push("stf-005", duplicate, "clock_out", "16:20");
  return events;
}

export function createSeedState(): DemoState {
  const rota = buildRota();
  const clockEvents = buildClockEvents();
  const payRates: PayRateHistory[] = staffSeed.flatMap((person, index) => [
    {
      id: id("rate", index + 1),
      staffId: person.id,
      payType: person.payType,
      hourlyRatePence: person.hourlyRatePence,
      monthlySalaryPence: person.monthlySalaryPence,
      effectiveFrom: person.startDate,
      effectiveTo: null,
      createdAt: now,
    },
  ]);

  return {
    schemaVersion: 4,
    staff: staffSeed,
    payRates,
    rota,
    clockEvents,
    attendanceApprovals: [],
    attendanceAdjustments: [
      {
        id: "adj-001",
        staffId: "stf-011",
        date: "2026-06-04",
        originalRecordedMinutes: 0,
        approvedMinutes: 420,
        reason: "Forgotten clock-in corrected from paper note",
        managerName: "Amelia Brooks",
        managerNote: "Manager verified arrival and finish time.",
        createdAt: "2026-06-04T17:20:00+01:00",
      },
    ],
    paySummaries: [],
    settings: {
      nurseryDisplayName: "Jan Pre-School and Nursery",
      defaultBreakMinutes: 30,
      lateArrivalThresholdMinutes: 10,
      overtimeWarningThresholdMinutes: 30,
      maximumShiftMinutes: 12 * 60,
      showWeekends: false,
      kioskAutoReturnSeconds: 4,
      attendanceDefaultRange: "current_week",
      attendanceDefaultTab: "needs_review",
      attendancePageSize: 25,
      materialPayAdjustmentThresholdPence: 100,
      defaultHolidayPayTreatment: "paid",
      defaultSicknessPayTreatment: "unpaid",
      defaultTrainingPayTreatment: "paid",
      allowBulkCleanApproval: true,
      showProvisionalHourlyPay: true,
      demoToday: "2026-06-08",
    },
  };
}
