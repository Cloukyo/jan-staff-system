"use client";

import { useId } from "react";
import { Delete } from "lucide-react";
import { Button } from "@/components/ui/primitives";

export function PinKeypad({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId}>
      <p id={labelId} className="mb-2 text-center text-lg font-bold">{label}</p>
      <div className="mb-5 min-h-20 rounded-lg bg-white p-5 text-center text-4xl tracking-[0.5rem] shadow-soft" role="status" aria-live="polite" aria-atomic="true" aria-label={`${label}, ${value.length} digits entered`}>
        {value.replace(/./g, "*") || " "}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
          <Button key={digit} type="button" variant="secondary" className="min-h-16 text-2xl" aria-label={`Enter digit ${digit}`} disabled={value.length >= 6} onClick={() => onChange(`${value}${digit}`)}>
            {digit}
          </Button>
        ))}
        <Button type="button" variant="secondary" className="min-h-16" disabled={!value.length} onClick={() => onChange("")}>Clear</Button>
        <Button type="button" variant="secondary" className="min-h-16 text-2xl" aria-label="Enter digit 0" disabled={value.length >= 6} onClick={() => onChange(`${value}0`)}>0</Button>
        <Button type="button" variant="secondary" className="min-h-16" aria-label="Delete last digit" disabled={!value.length} onClick={() => onChange(value.slice(0, -1))}>
          <Delete className="h-6 w-6" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
