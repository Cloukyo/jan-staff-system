import { ManagerApp } from "@/components/app/prototype-app";

export function DashboardRoute() {
  return <ManagerApp screen="dashboard" />;
}

export function StaffRoute() {
  return <ManagerApp screen="staff" />;
}

export function RotaRoute() {
  return <ManagerApp screen="rota" />;
}

export function AttendanceRoute() {
  return <ManagerApp screen="attendance" />;
}

export function PayrollRoute() {
  return <ManagerApp screen="payroll" />;
}

export function SettingsRoute() {
  return <ManagerApp screen="settings" />;
}
