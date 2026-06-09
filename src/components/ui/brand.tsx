import Image from "next/image";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white shadow-soft ring-1 ring-purple-100">
        <Image src="/brand/jan-logo.png" alt="" width={34} height={34} className="h-8 w-8 object-contain" />
      </div>
      {!compact && (
        <div>
          <p className="text-base font-bold leading-tight text-purple-950">Jan Staff</p>
          <p className="text-xs font-medium text-purple-700">Rota, Attendance and Pay Preparation</p>
        </div>
      )}
    </div>
  );
}
