"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, CalendarDays, ClipboardCheck, Clock, CreditCard, LogOut, Menu, Settings, Users } from "lucide-react";
import { useState } from "react";
import { BrandMark } from "@/components/ui/brand";
import { Button } from "@/components/ui/primitives";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/staff", label: "Staff", icon: Users },
  { href: "/rota", label: "Rota", icon: CalendarDays },
  { href: "/clock", label: "Kiosk", icon: Clock },
  { href: "/attendance", label: "Attendance", icon: ClipboardCheck },
  { href: "/payroll", label: "Pay prep", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const isClock = pathname === "/clock";

  if (isClock) return <>{children}</>;

  function logout() {
    window.localStorage.removeItem("jan-staff-manager-session");
    router.push("/login");
  }

  const menu = (
    <nav className="mt-8 grid gap-1" aria-label="Main navigation">
      {nav.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href || (pathname === "/" && item.href === "/dashboard");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-bold transition ${
              active ? "bg-purple-700 text-white shadow-sm" : "text-purple-900 hover:bg-purple-50"
            }`}
            onClick={() => setOpen(false)}
          >
            <Icon aria-hidden className="h-5 w-5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-lavender">
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-purple-100 bg-white/95 p-5 lg:block">
        <BrandMark />
        {menu}
        <div className="absolute bottom-5 left-5 right-5">
          <Button variant="ghost" className="w-full justify-start" onClick={logout}>
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>
      <header className="sticky top-0 z-30 border-b border-purple-100 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between">
          <BrandMark compact />
          <Button variant="secondary" aria-label="Open navigation" onClick={() => setOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
        </div>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 bg-purple-950/30 lg:hidden" role="presentation" onClick={() => setOpen(false)}>
          <div className="h-full w-80 bg-white p-5" onClick={(event) => event.stopPropagation()}>
            <BrandMark />
            {menu}
          </div>
        </div>
      )}
      <main className="px-4 py-6 lg:ml-72 lg:px-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
