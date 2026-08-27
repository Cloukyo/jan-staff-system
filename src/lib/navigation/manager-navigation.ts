import {
  BarChart3,
  CalendarDays,
  CalendarX2,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  FileSpreadsheet,
  KeyRound,
  LayoutTemplate,
  Settings,
  Users,
  Building2,
  MapPin,
  ShieldCheck,
  MonitorSmartphone,
  CreditCard,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: string;
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

export const commercialAdminNavigation: NavGroup[] = [
  {
    label: "Administration",
    items: [
      { href: "/admin", label: "Overview", icon: BarChart3, active: (path) => path === "/admin" },
      { href: "/admin/organisation", label: "Organisation", icon: Building2, permission: "organisation.manage" },
      { href: "/admin/sites", label: "Sites", icon: MapPin, permission: "site.manage" },
      { href: "/admin/staff", label: "Staff", icon: Users, permission: "staff.manage" },
      { href: "/admin/access", label: "Access", icon: ShieldCheck, permission: "membership.manage" },
      { href: "/admin/devices", label: "Clocking-in devices", icon: MonitorSmartphone, permission: "kiosk.manage" },
      { href: "/admin/settings", label: "Operational settings", icon: Settings, permission: "settings.manage" },
      { href: "/admin/settings/sites", label: "Site hours", icon: Clock3, permission: "settings.manage" },
      { href: "/admin/billing", label: "Plan and billing", icon: CreditCard, permission: "billing.manage" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/dashboard", label: "Return to operations", icon: ClipboardCheck },
      { href: "/help", label: "Help", icon: CircleHelp },
    ],
  },
];

export function navigationForPermissions(groups: NavGroup[], permissions: readonly string[]): NavGroup[] {
  const available = new Set(permissions);
  return groups.map((group) => ({ ...group, items: group.items.filter((item) => !item.permission || available.has(item.permission)) })).filter((group) => group.items.length > 0);
}

export function itemIsActive(item: NavItem, pathname: string): boolean {
  if (item.active) return item.active(pathname);
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
