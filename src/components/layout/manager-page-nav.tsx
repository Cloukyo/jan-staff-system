"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId } from "react";

export type ManagerPageNavItem = {
  id: string;
  label: string;
  href: string;
};

export type ManagerPageNavProps = {
  items: ManagerPageNavItem[];
  activeId: string;
  label: string;
};

export function ManagerPageNav({
  items,
  activeId,
  label,
}: ManagerPageNavProps) {
  const router = useRouter();
  const selectId = useId();
  const activeItem = items.find((item) => item.id === activeId);

  return (
    <nav className="manager-page-nav sticky" aria-label={label}>
      <div className="manager-page-nav__mobile">
        <label htmlFor={selectId}>Jump to</label>
        <select
          id={selectId}
          value={activeItem?.href ?? ""}
          onChange={(event) => router.push(event.target.value)}
        >
          {items.map((item) => (
            <option key={item.id} value={item.href}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      <div className="manager-page-nav__links">
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
