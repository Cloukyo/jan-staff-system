"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { inputClassName } from "@/components/ui/primitives";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  hideLabel?: string;
  leftIcon?: ReactNode;
  revealLabel?: string;
};

export function PasswordInput({
  className = "",
  hideLabel = "Hide password",
  leftIcon,
  revealLabel = "Show password",
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const label = visible ? hideLabel : revealLabel;

  return (
    <div className="relative">
      {leftIcon ? <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-purple-400">{leftIcon}</span> : null}
      <input
        {...props}
        className={inputClassName(`w-full pr-12 ${leftIcon ? "pl-10" : ""} ${className}`)}
        type={visible ? "text" : "password"}
      />
      <button
        aria-label={label}
        aria-pressed={visible}
        className="absolute right-2 top-1/2 inline-flex min-h-9 min-w-9 -translate-y-1/2 items-center justify-center rounded-lg text-purple-700 transition hover:bg-purple-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-700"
        onClick={() => setVisible((current) => !current)}
        type="button"
      >
        {visible ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
      </button>
    </div>
  );
}
