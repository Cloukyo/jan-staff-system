"use client";

import { Delete } from "lucide-react";
import { Button } from "@/components/ui/primitives";

export function PinKeypad({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <div>
      <p className="mb-2 text-center text-lg font-bold">{label}</p>
      <div className="mb-5 min-h-20 rounded-lg bg-white p-5 text-center text-4xl tracking-[0.5rem] shadow-soft" aria-label={`${label}, ${value.length} digits entered`}>
        {value.replace(/./g, "*") || " "}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
          <Button key={digit} type="button" variant="secondary" className="min-h-16 text-2xl" onClick={() => value.length < 6 && onChange(`${value}${digit}`)}>
            {digit}
          </Button>
        ))}
        <Button type="button" variant="secondary" className="min-h-16" onClick={() => onChange("")}>Clear</Button>
        <Button type="button" variant="secondary" className="min-h-16 text-2xl" onClick={() => value.length < 6 && onChange(`${value}0`)}>0</Button>
        <Button type="button" variant="secondary" className="min-h-16" aria-label="Delete digit" onClick={() => onChange(value.slice(0, -1))}>
          <Delete className="h-6 w-6" />
        </Button>
      </div>
    </div>
  );
}
