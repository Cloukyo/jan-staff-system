import {
  BarChart3,
  CalendarDays,
  CalendarX2,
  CircleHelp,
  ClipboardCheck,
  FileSpreadsheet,
  KeyRound,
  LayoutTemplate,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  active?: (pathname: string) => boolean;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const managerNavigation: NavGroup[] = [
  {
    label: "Daily work",
    items: [
      { href: "/dashboard", label: "Home", icon: BarChart3 },
      {
        href: "/rota",
        label: "Rota",
        icon: CalendarDays,
        active: (path) =>
          path === "/rota" ||
          (path.startsWith("/rota/") && !path.startsWith("/rota/templates")),
      },
      {
        href: "/attendance",
        label: "Clock-ins & hours",
        icon: ClipboardCheck,
      },
      {
        href: "/leave/requests",
        label: "Leave requests",
        icon: CalendarX2,
        active: (path) => path.startsWith("/leave"),
      },
    ],
  },
  {
    label: "Staff",
    items: [{
      href: "/staff",
      label: "Staff records",
      icon: Users,
      active: (path) =>
        path === "/staff"
        || path.startsWith("/staff/")
        || path.startsWith("/compliance/staff/"),
    }],
  },
  {
    label: "Pay hours",
    items: [
      {
        href: "/payroll",
        label: "Export pay hours",
        icon: FileSpreadsheet,
        active: (path) => path === "/payroll" || path.startsWith("/payroll/"),
      },
    ],
  },
  {
    label: "Settings",
    items: [
      {
        href: "/rota/templates",
        label: "Rota templates",
        icon: LayoutTemplate,
        active: (path) => path.startsWith("/rota/templates"),
      },
      {
        href: "/settings/kiosk",
        label: "Clocking-in devices",
        icon: KeyRound,
      },
      {
        href: "/settings",
        label: "Site settings",
        icon: Settings,
        active: (path) => path === "/settings",
      },
    ],
  },
  {
    label: "Support",
    items: [{ href: "/help", label: "Help", icon: CircleHelp }],
  },
];

export function itemIsActive(item: NavItem, pathname: string): boolean {
  if (item.active) return item.active(pathname);
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
