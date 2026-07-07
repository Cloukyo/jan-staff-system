import Image from "next/image";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-mark flex items-center gap-3">
      <div className="brand-mark__logo grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white shadow-soft ring-1 ring-purple-100">
        <Image src="/brand/jan-logo.png" alt="" width={42} height={42} className="brand-mark__image h-10 w-10 object-contain" />
      </div>
      {!compact && (
        <div className="brand-mark__text">
          <p className="brand-mark__title text-base font-bold leading-tight text-purple-950">Jan Staff</p>
          <p className="brand-mark__subtitle text-xs font-medium text-purple-700">Rota, Attendance and Pay Preparation</p>
        </div>
      )}
    </div>
  );
}
