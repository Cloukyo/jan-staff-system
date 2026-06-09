"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { addDays, eachDayOfInterval, format, parseISO } from "date-fns";
import type {
  AttendanceAdjustment,
  AttendanceApproval,
  AttendanceDay,
  ClockEvent,
  ClockEventType,
  DemoState,
  PayPeriodSummary,
  PayRateHistory,
  RotaShift,
  StaffMember,
} from "@/types";
import { calculateAttendanceDay } from "@/lib/calculations/attendance";
import { createPaySummary } from "@/lib/calculations/pay";
import { createSeedState } from "@/lib/demo-data/seed";
import { prototypeHashPin, verifyPrototypePin } from "@/lib/pin/service";

const STORAGE_KEY = "jan-staff-demo-state-v4";
const LEGACY_STORAGE_KEYS = ["jan-staff-demo-state-v3", "jan-staff-demo-state-v2", "jan-staff-demo-state-v1"];

interface DemoRepository {
  state: DemoState;
  hydrated: boolean;
  reseed: () => void;
  addStaff: (staff: Omit<StaffMember, "id" | "createdAt" | "updatedAt" | "pinHash" | "failedPinAttempts" | "lockedUntil"> & { temporaryPin: string }) => void;
  updateStaff: (staff: StaffMember, rate?: Omit<PayRateHistory, "id" | "createdAt">) => void;
  saveShift: (shift: RotaShift) => void;
  copyPreviousWeek: (weekStart: string, staffId?: string) => void;
  clearWeek: (weekStart: string) => void;
  addClockEvent: (staffId: string, type: ClockEventType) => void;
  verifyPin: (staffId: string, pin: string) => "ok" | "change_required" | "locked" | "error";
  changePin: (staffId: string, newPin: string) => void;
  addAdjustment: (adjustment: Omit<AttendanceAdjustment, "id" | "createdAt" | "managerName">) => void;
  approveCleanDays: (days: AttendanceDay[], method?: AttendanceApproval["approvalMethod"]) => { approved: number; skipped: string[] };
  savePaySummary: (summary: PayPeriodSummary) => void;
  updateSettings: (settings: DemoState["settings"]) => void;
  addDevelopmentScenario: (kind: string) => void;
  clearDevelopmentScenarios: () => void;
  attendanceDays: (periodStart: string, periodEnd: string, staffId?: string) => AttendanceDay[];
  paySummaries: (periodStart: string, periodEnd: string) => PayPeriodSummary[];
}

const RepositoryContext = createContext<DemoRepository | null>(null);

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function loadState(): DemoState {
  if (typeof window === "undefined") return createSeedState();
  const saved = window.localStorage.getItem(STORAGE_KEY) ?? LEGACY_STORAGE_KEYS.map((key) => window.localStorage.getItem(key)).find(Boolean);
  if (!saved) return createSeedState();
  try {
    return migrateState(JSON.parse(saved) as Partial<DemoState>);
  } catch {
    return createSeedState();
  }
}

export function repairContractedWeeklyMinutes(value: number | undefined): number {
  const safe = value ?? 0;
  return safe > 0 && safe <= 80 ? safe * 60 : safe;
}

export function migrateState(input: Partial<DemoState>): DemoState {
  const seed = createSeedState();
  const settings = { ...seed.settings, ...(input.settings ?? {}) };
  return {
    ...seed,
    ...input,
    schemaVersion: 4,
    settings,
    staff: (input.staff ?? seed.staff).map((person) => ({
      ...person,
      contractedWeeklyMinutes: repairContractedWeeklyMinutes(person.contractedWeeklyMinutes),
      failedPinAttempts: person.failedPinAttempts ?? 0,
      lockedUntil: person.lockedUntil ?? null,
      pinIsTemporary: person.pinIsTemporary ?? false,
    })),
    rota: (input.rota ?? seed.rota).map((shift) => {
      const seedShift = seed.rota.find((item) => item.id === shift.id || (item.staffId === shift.staffId && item.date === shift.date));
      return {
        ...shift,
        payTreatment:
          shift.payTreatment ?? (shift.status === "holiday" ? settings.defaultHolidayPayTreatment : shift.status === "sick" ? settings.defaultSicknessPayTreatment : shift.status === "training" ? settings.defaultTrainingPayTreatment : undefined),
        creditedMinutes: shift.creditedMinutes ?? seedShift?.creditedMinutes ?? (shift.status === "holiday" || shift.status === "training" ? 7 * 60 + 30 : shift.status === "sick" ? 0 : undefined),
        payableMinutes: shift.payableMinutes ?? seedShift?.payableMinutes,
      };
    }),
    attendanceApprovals: (input.attendanceApprovals ?? []).map((approval) => ({
      ...approval,
      approvedBy: approval.approvedBy ?? approval.managerName ?? "Nursery Manager",
      approvedAt: approval.approvedAt ?? approval.createdAt,
      approvalMethod:
        approval.approvalMethod ??
        (approval.method === "individual_clean" ? "individual" : approval.method === "bulk_clean" ? "bulk_range" : "individual"),
      recordedMinutesAtApproval: approval.recordedMinutesAtApproval ?? approval.approvedMinutes,
      wasAdjusted: approval.wasAdjusted ?? false,
      adjustmentReason: approval.adjustmentReason ?? null,
      approvalVersion: approval.approvalVersion ?? 1,
      previousApprovalId: approval.previousApprovalId ?? null,
    })),
    attendanceAdjustments: input.attendanceAdjustments ?? [],
    paySummaries: input.paySummaries ?? [],
  };
}

export function DemoStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DemoState>(() => createSeedState());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setState(loadState());
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [hydrated, state]);

  const repository = useMemo<DemoRepository>(() => {
    const attendanceDays = (periodStart: string, periodEnd: string, staffId?: string) => {
      const dates = eachDayOfInterval({ start: parseISO(periodStart), end: parseISO(periodEnd) }).map((date) => format(date, "yyyy-MM-dd"));
      return state.staff
        .filter((person) => !staffId || person.id === staffId)
        .flatMap((person) =>
          dates.map((date) =>
            calculateAttendanceDay(
              person.id,
              date,
              state.clockEvents,
              state.rota.find((shift) => shift.staffId === person.id && shift.date === date),
              state.attendanceAdjustments.find((adjustment) => adjustment.staffId === person.id && adjustment.date === date),
              state.attendanceApprovals.filter((approval) => approval.staffId === person.id && approval.date === date).at(-1),
              state.settings,
            ),
          ),
        )
        .filter((day) => day.scheduledMinutes > 0 || day.events.length > 0 || day.approvedPayableMinutes > 0);
    };

    return {
      state,
      hydrated,
      reseed: () => setState(createSeedState()),
      addStaff: (input) =>
        setState((current) => {
          const createdAt = new Date().toISOString();
          const staff: StaffMember = {
            ...input,
            id: uid("stf"),
            createdAt,
            updatedAt: createdAt,
            pinHash: prototypeHashPin(input.temporaryPin),
            pinIsTemporary: true,
            failedPinAttempts: 0,
            lockedUntil: null,
          };
          const rate: PayRateHistory = {
            id: uid("rate"),
            staffId: staff.id,
            payType: staff.payType,
            hourlyRatePence: staff.hourlyRatePence,
            monthlySalaryPence: staff.monthlySalaryPence,
            effectiveFrom: staff.startDate,
            effectiveTo: null,
            createdAt,
          };
          return { ...current, staff: [...current.staff, staff], payRates: [...current.payRates, rate] };
        }),
      updateStaff: (staff, rate) =>
        setState((current) => ({
          ...current,
          staff: current.staff.map((item) => (item.id === staff.id ? { ...staff, updatedAt: new Date().toISOString() } : item)),
          payRates: rate
            ? [
                ...current.payRates.map((item) =>
                  item.staffId === staff.id && !item.effectiveTo ? { ...item, effectiveTo: rate.effectiveFrom } : item,
                ),
                { ...rate, id: uid("rate"), createdAt: new Date().toISOString() },
              ]
            : current.payRates,
        })),
      saveShift: (shift) =>
        setState((current) => ({
          ...current,
          rota: current.rota.some((item) => item.id === shift.id)
            ? current.rota.map((item) => (item.id === shift.id ? shift : item))
            : [...current.rota, { ...shift, id: uid("rot") }],
        })),
      copyPreviousWeek: (weekStart, staffId) =>
        setState((current) => {
          const previous = addDays(parseISO(weekStart), -7);
          const previousStart = previous.toISOString().slice(0, 10);
          const staffFilter = (shift: RotaShift) => !staffId || shift.staffId === staffId;
          const copied = current.rota
            .filter((shift) => shift.date >= previousStart && shift.date < weekStart && staffFilter(shift))
            .map((shift) => ({ ...shift, id: uid("rot"), date: format(addDays(parseISO(shift.date), 7), "yyyy-MM-dd") }));
          const copiedKeys = new Set(copied.map((shift) => `${shift.staffId}-${shift.date}`));
          return { ...current, rota: [...current.rota.filter((shift) => !copiedKeys.has(`${shift.staffId}-${shift.date}`)), ...copied] };
        }),
      clearWeek: (weekStart) =>
        setState((current) => {
          const weekEnd = format(addDays(parseISO(weekStart), 7), "yyyy-MM-dd");
          return { ...current, rota: current.rota.filter((shift) => shift.date < weekStart || shift.date >= weekEnd) };
        }),
      addClockEvent: (staffId, type) =>
        setState((current) => {
          const timestamp = new Date().toISOString();
          const event: ClockEvent = { id: uid("clk"), staffId, type, timestamp, source: "kiosk", createdAt: timestamp };
          return { ...current, clockEvents: [...current.clockEvents, event] };
        }),
      verifyPin: (staffId, pin) => {
        const person = state.staff.find((item) => item.id === staffId);
        if (!person) return "error";
        if (person.lockedUntil && new Date(person.lockedUntil) > new Date()) return "locked";
        if (verifyPrototypePin(pin, person.pinHash)) return person.pinIsTemporary ? "change_required" : "ok";
        setState((current) => ({
          ...current,
          staff: current.staff.map((item) => {
            if (item.id !== staffId) return item;
            const failedPinAttempts = item.failedPinAttempts + 1;
            return {
              ...item,
              failedPinAttempts,
              lockedUntil: failedPinAttempts >= 3 ? new Date(Date.now() + 60_000).toISOString() : null,
            };
          }),
        }));
        return "error";
      },
      changePin: (staffId, newPin) =>
        setState((current) => ({
          ...current,
          staff: current.staff.map((person) =>
            person.id === staffId
              ? { ...person, pinHash: prototypeHashPin(newPin), pinIsTemporary: false, failedPinAttempts: 0, lockedUntil: null }
              : person,
          ),
        })),
      addAdjustment: (adjustment) =>
        setState((current) => ({
          ...current,
          attendanceAdjustments: [
            ...current.attendanceAdjustments.filter((item) => !(item.staffId === adjustment.staffId && item.date === adjustment.date)),
            { ...adjustment, id: uid("adj"), managerName: "Amelia Brooks", createdAt: new Date().toISOString() },
          ],
        })),
      approveCleanDays: (days, method = "bulk_selected") => {
        const skipped: string[] = [];
        const approvals = days.flatMap((day) => {
          const serious = day.exceptionFlags.some((flag) =>
            ["No clock-in", "Missing clock-out", "Break before", "Break end without", "Missing break end", "Clock-out without", "Unscheduled", "safety", "Paid status missing"].some((token) => flag.includes(token)),
          );
          if (day.approvalStatus === "approved") {
            skipped.push(`${day.staffId} ${day.date}: already approved`);
            return [];
          }
          if (serious || !day.firstClockIn || !day.finalClockOut || day.recordedMinutes <= 0 || day.adjustmentReason) {
            skipped.push(`${day.staffId} ${day.date}: requires individual review`);
            return [];
          }
          return [
            {
              id: uid("apr"),
              staffId: day.staffId,
              date: day.date,
              approvedBy: "Nursery Manager",
              approvedAt: new Date().toISOString(),
              approvalMethod: method,
              recordedMinutesAtApproval: day.recordedMinutes,
              approvedMinutes: day.recordedMinutes,
              wasAdjusted: false,
              adjustmentReason: null,
              approvalVersion: 1,
              previousApprovalId: state.attendanceApprovals.find((item) => item.staffId === day.staffId && item.date === day.date)?.id ?? null,
              managerName: "Amelia Brooks",
              method: (method === "individual" ? "individual_clean" : "bulk_clean") as "individual_clean" | "bulk_clean",
              createdAt: new Date().toISOString(),
            },
          ];
        });
        if (approvals.length) {
          setState((current) => ({
            ...current,
            attendanceApprovals: [
              ...current.attendanceApprovals,
              ...approvals.map((approval) => {
                const previousForDay = current.attendanceApprovals.filter((item) => item.staffId === approval.staffId && item.date === approval.date);
                return {
                  ...approval,
                  previousApprovalId: previousForDay.at(-1)?.id ?? null,
                  approvalVersion: previousForDay.length + 1,
                };
              }),
            ],
          }));
        }
        return { approved: approvals.length, skipped };
      },
      savePaySummary: (summary) =>
        setState((current) => ({
          ...current,
          paySummaries: [
            ...current.paySummaries.filter(
              (item) => !(item.staffId === summary.staffId && item.periodStart === summary.periodStart && item.periodEnd === summary.periodEnd),
            ),
            summary,
          ],
        })),
      updateSettings: (settings) => setState((current) => ({ ...current, settings })),
      addDevelopmentScenario: (kind) =>
        setState((current) => {
          const date = current.settings.demoToday;
          const staffId = current.staff.find((person) => person.active && person.payType === "hourly")?.id ?? current.staff[0].id;
          const createdAt = new Date().toISOString();
          if (kind === "paid_holiday" || kind === "unpaid_sickness" || kind === "paid_training") {
            const status = kind === "paid_holiday" ? "holiday" : kind === "paid_training" ? "training" : "sick";
            const paid = kind !== "unpaid_sickness";
            const shift: RotaShift = {
              id: uid(`scenario-${kind}`),
              staffId,
              date,
              scheduledStart: null,
              scheduledEnd: null,
              status,
              plannedBreakMinutes: 0,
              payTreatment: paid ? "paid" : "unpaid",
              creditedMinutes: paid ? 450 : 0,
              payableMinutes: paid ? 450 : 0,
              notes: `Development scenario: ${kind.replaceAll("_", " ")}`,
            };
            return { ...current, rota: [...current.rota.filter((shiftItem) => !(shiftItem.staffId === staffId && shiftItem.date === date)), shift] };
          }
          const base = `${date}T`;
          const eventMap: Record<string, ClockEvent[]> = {
            clean_week: ["clock_in", "clock_out"].map((type, index) => ({ id: uid(`scenario-clean-${type}`), staffId, timestamp: `${base}${index ? "16:30" : "08:30"}:00+01:00`, type: type as ClockEventType, source: "manager", createdAt })),
            missing_clock_out: [{ id: uid("scenario-missing-out"), staffId, timestamp: `${base}08:30:00+01:00`, type: "clock_in", source: "manager", createdAt }],
            late_arrival: [{ id: uid("scenario-late-in"), staffId, timestamp: `${base}09:30:00+01:00`, type: "clock_in", source: "manager", createdAt }, { id: uid("scenario-late-out"), staffId, timestamp: `${base}16:30:00+01:00`, type: "clock_out", source: "manager", createdAt }],
            early_departure: [{ id: uid("scenario-early-in"), staffId, timestamp: `${base}08:30:00+01:00`, type: "clock_in", source: "manager", createdAt }, { id: uid("scenario-early-out"), staffId, timestamp: `${base}14:30:00+01:00`, type: "clock_out", source: "manager", createdAt }],
            overtime_day: [{ id: uid("scenario-ot-in"), staffId, timestamp: `${base}07:30:00+01:00`, type: "clock_in", source: "manager", createdAt }, { id: uid("scenario-ot-out"), staffId, timestamp: `${base}18:30:00+01:00`, type: "clock_out", source: "manager", createdAt }],
          };
          return { ...current, clockEvents: [...current.clockEvents, ...(eventMap[kind] ?? eventMap.missing_clock_out)] };
        }),
      clearDevelopmentScenarios: () =>
        setState((current) => ({
          ...current,
          clockEvents: current.clockEvents.filter((event) => !event.id.startsWith("scenario-")),
          rota: current.rota.filter((shift) => !shift.id.startsWith("scenario-")),
          payRates: current.payRates.filter((rate) => !rate.id.startsWith("scenario-")),
        })),
      attendanceDays,
      paySummaries: (periodStart, periodEnd) =>
        state.staff
          .filter((person) => person.active)
          .map((person) =>
            createPaySummary(
              person,
              attendanceDays(periodStart, periodEnd, person.id),
              state.payRates,
              periodStart,
              periodEnd,
              state.paySummaries.find((item) => item.staffId === person.id && item.periodStart === periodStart && item.periodEnd === periodEnd),
            ),
          ),
    };
  }, [hydrated, state]);

  return <RepositoryContext.Provider value={repository}>{children}</RepositoryContext.Provider>;
}

export function useDemoRepository(): DemoRepository {
  const repository = useContext(RepositoryContext);
  if (!repository) throw new Error("useDemoRepository must be used inside DemoStoreProvider");
  return repository;
}
