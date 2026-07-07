"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  CalendarPlus,
  CalendarX2,
  Clock3,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FileSpreadsheet,
  KeyRound,
  LayoutTemplate,
  LogOut,
  Menu,
  Settings,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/ui/brand";
import { Button } from "@/components/ui/primitives";
import { signOutAction } from "@/lib/auth/actions";
import type { AppRole } from "@/types";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Users;
  active?: (pathname: string) => boolean;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const managerNavigation: NavGroup[] = [
  {
    label: "Daily",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
      { href: "/rota", label: "Rota", icon: CalendarDays, active: (path) => path === "/rota" || (path.startsWith("/rota/") && !path.startsWith("/rota/templates")) },
      { href: "/attendance", label: "Attendance", icon: ClipboardCheck },
      { href: "/leave/requests", label: "Leave", icon: CalendarX2, active: (path) => path.startsWith("/leave") },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/staff", label: "Staff", icon: Users },
      { href: "/compliance", label: "Compliance", icon: ClipboardList, active: (path) => path.startsWith("/compliance") },
      { href: "/accounts", label: "Accounts", icon: UserRound },
    ],
  },
  {
    label: "Pay",
    items: [
      { href: "/payroll/arrangements", label: "Pay arrangements", icon: CreditCard },
      { href: "/payroll/review", label: "Payroll review", icon: FileSpreadsheet },
      { href: "/payroll", label: "Pay preparation", icon: CreditCard, active: (path) => path === "/payroll" },
    ],
  },
  {
    label: "Setup",
    items: [
      { href: "/rota/templates", label: "Rota templates", icon: LayoutTemplate, active: (path) => path.startsWith("/rota/templates") },
      { href: "/settings/kiosk", label: "Kiosk setup", icon: KeyRound },
      { href: "/settings", label: "Settings", icon: Settings, active: (path) => path === "/settings" },
    ],
  },
];

const staffNavigation: NavGroup[] = [
  {
    label: "My work",
    items: [
      { href: "/my-rota", label: "My rota", icon: CalendarDays },
      { href: "/leave", label: "My leave", icon: CalendarDays, active: (path) => path === "/leave" },
      { href: "/leave/request", label: "Request leave", icon: CalendarPlus },
      { href: "/my-attendance", label: "My attendance", icon: Clock3 },
      { href: "/profile", label: "Profile", icon: UserRound },
    ],
  },
];

function itemIsActive(item: NavItem, pathname: string): boolean {
  if (item.active) return item.active(pathname);
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function AppShell({ children, role = "manager" }: { children: React.ReactNode; role?: AppRole }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const navigation = role === "staff" ? staffNavigation : managerNavigation;

  useEffect(() => {
    if (!open) return;
    const drawer = drawerRef.current;
    const menuButton = menuButtonRef.current;
    const focusable = drawer?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
    focusable?.[0]?.focus();

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      menuButton?.focus();
    };
  }, [open]);

  function closeMenu() {
    setOpen(false);
  }

  const menu = (
    <nav className="app-shell__nav grid gap-6" aria-label="Main navigation">
      {navigation.map((group) => (
        <section className="app-shell__nav-group" key={group.label} aria-labelledby={`nav-${group.label.toLowerCase().replaceAll(" ", "-")}`}>
          <h2 id={`nav-${group.label.toLowerCase().replaceAll(" ", "-")}`} className="app-shell__nav-heading px-3 text-xs font-black uppercase text-slate-500">
            {group.label}
          </h2>
          <div className="app-shell__nav-items mt-2 grid gap-1">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = itemIsActive(item, pathname);
              return (
                <Link
                  key={`${group.label}-${item.href}`}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`app-shell__nav-link flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-bold transition ${
                    active ? "bg-purple-700 text-white shadow-sm" : "text-purple-900 hover:bg-purple-50"
                  }`}
                  onClick={closeMenu}
                >
                  <Icon aria-hidden className="app-shell__nav-icon h-5 w-5 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </nav>
  );

  const signOut = (
    <form className="app-shell__signout" action={signOutAction} onSubmit={() => window.localStorage.removeItem("jan-staff-manager-session")}>
      <Button type="submit" variant="ghost" className="w-full justify-start app-shell__signout-button">
        <LogOut className="h-4 w-4" /> Sign out
      </Button>
    </form>
  );

  return (
    <div className="app-shell min-h-screen bg-lavender">
      <aside className="app-shell__sidebar fixed inset-y-0 left-0 hidden w-72 flex-col border-r border-purple-100 bg-white/95 lg:flex">
        <div className="app-shell__sidebar-brand border-b border-purple-100 p-5"><BrandMark /></div>
        <div className="app-shell__sidebar-menu min-h-0 flex-1 overflow-y-auto px-5 py-6">{menu}</div>
        <div className="app-shell__sidebar-footer border-t border-purple-100 p-5">{signOut}</div>
      </aside>
      <header className="app-shell__mobile-header sticky top-0 z-30 border-b border-purple-100 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <div className="app-shell__mobile-header-inner flex items-center justify-between">
          <BrandMark compact />
          <button
            ref={menuButtonRef}
            type="button"
            aria-label="Open navigation"
            aria-expanded={open}
            className="app-shell__menu-button inline-flex min-h-11 items-center justify-center rounded-xl bg-white px-4 py-2 text-purple-900 shadow-sm ring-1 ring-purple-200 transition hover:bg-purple-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-700"
            onClick={() => setOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>
      {open ? (
        <div className="app-shell__drawer-backdrop fixed inset-0 z-40 bg-purple-950/30 lg:hidden" role="presentation" onClick={closeMenu}>
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="app-shell__drawer flex h-full w-[min(22rem,90vw)] flex-col bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="app-shell__drawer-header flex items-center justify-between border-b border-purple-100 p-5">
              <BrandMark />
              <Button variant="ghost" aria-label="Close navigation" onClick={closeMenu}><X className="h-5 w-5" /></Button>
            </div>
            <div className="app-shell__drawer-menu min-h-0 flex-1 overflow-y-auto p-5">{menu}</div>
            <div className="app-shell__drawer-footer border-t border-purple-100 p-5">{signOut}</div>
          </div>
        </div>
      ) : null}
      <main className="app-shell__main px-4 py-6 lg:ml-72 lg:px-8">
        <div className="app-shell__content mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
