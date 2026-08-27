import Image from "next/image";
import { getPlatformBranding } from "@/lib/platform/branding";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  const branding = getPlatformBranding();
  return (
    <div className="brand-mark flex items-center gap-3">
      <div className="brand-mark__logo grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white shadow-soft ring-1 ring-purple-100">
        {branding.productLogoPath ? (
          <Image src={branding.productLogoPath} alt="" width={42} height={42} className="brand-mark__image h-10 w-10 object-contain" />
        ) : (
          <span className="text-sm font-black text-purple-800" aria-hidden>WP</span>
        )}
      </div>
      {!compact && (
        <div className="brand-mark__text">
          <p className="brand-mark__title text-base font-bold leading-tight text-purple-950">{branding.productShortName}</p>
          <p className="brand-mark__subtitle text-xs font-medium text-purple-700">Rota, Attendance and Pay Preparation</p>
        </div>
      )}
    </div>
  );
}
