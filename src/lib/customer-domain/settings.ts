import type {
  OrganisationOperationalSettings,
  SiteOperationalSettingsOverride,
} from "@/types/customer-domain";

function defined<T>(override: T | null | undefined, fallback: T): T {
  return override === null || override === undefined ? fallback : override;
}

export function resolveOperationalSettings(
  organisation: OrganisationOperationalSettings,
  site: SiteOperationalSettingsOverride | null | undefined,
): OrganisationOperationalSettings {
  return {
    timezone: defined(site?.timezone, organisation.timezone),
    workWeekStarts: defined(site?.workWeekStarts, organisation.workWeekStarts),
    operatingHours: {
      openingTime: defined(site?.operatingHours?.openingTime, organisation.operatingHours.openingTime),
      closingTime: defined(site?.operatingHours?.closingTime, organisation.operatingHours.closingTime),
    },
    staffing: {
      defaultBreakMinutes: defined(site?.staffing?.defaultBreakMinutes, organisation.staffing.defaultBreakMinutes),
      minimumStaff: defined(site?.staffing?.minimumStaff, organisation.staffing.minimumStaff),
    },
  };
}
