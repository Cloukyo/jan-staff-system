import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const variants = {
    primary: "bg-purple-700 text-white hover:bg-purple-800 focus-visible:outline-purple-700",
    secondary: "bg-white text-purple-900 ring-1 ring-purple-200 hover:bg-purple-50 focus-visible:outline-purple-700",
    danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-700",
    ghost: "bg-transparent text-purple-800 hover:bg-purple-50 focus-visible:outline-purple-700",
  };
  return (
    <button
      className={`ui-button ui-button--${variant} inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`ui-panel rounded-lg border border-purple-100 bg-white p-5 shadow-soft ${className}`}>{children}</section>;
}

export function Field({ label, children, error }: { label: string; children: ReactNode; error?: string }) {
  return (
    <label className="ui-field grid gap-1 text-sm font-semibold text-purple-950">
      <span>{label}</span>
      {children}
      {error && <span className="text-sm font-medium text-red-700">{error}</span>}
    </label>
  );
}

export function inputClassName(extra = "") {
  return `ui-input min-h-11 rounded-lg border border-purple-200 bg-white px-3 py-2 text-sm text-purple-950 outline-none transition placeholder:text-purple-300 focus:border-purple-500 focus:ring-4 focus:ring-purple-100 ${extra}`;
}

export function StatusPill({ tone, children }: { tone: "green" | "amber" | "red" | "grey" | "purple"; children: ReactNode }) {
  const tones = {
    green: "bg-green-50 text-green-800 ring-green-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    red: "bg-red-50 text-red-800 ring-red-200",
    grey: "bg-slate-100 text-slate-700 ring-slate-200",
    purple: "bg-purple-50 text-purple-800 ring-purple-200",
  };
  return <span className={`ui-status-pill ui-status-pill--${tone} inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${tones[tone]}`}>{children}</span>;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="ui-empty-state rounded-lg border border-dashed border-purple-200 bg-purple-50/60 p-6 text-center">
      <p className="font-bold text-purple-950">{title}</p>
      <p className="mt-1 text-sm text-purple-700">{body}</p>
    </div>
  );
}
