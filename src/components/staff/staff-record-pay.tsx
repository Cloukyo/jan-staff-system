"use client";

import { StaffPayCard } from "@/components/payroll/pay-arrangements-screen";
import type { ProductionStaffRow } from "@/lib/payroll/types";

export function StaffRecordPay({ person }: { person: ProductionStaffRow }) {
  return <StaffPayCard person={person} initiallyOpen showStaffRecordLink={false} />;
}
