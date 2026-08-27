export type OperatingHours = {
  openingTime: string;
  closingTime: string;
};

export type StaffingDefaults = {
  defaultBreakMinutes: number;
  minimumStaff: number;
};

export type OrganisationOperationalSettings = {
  timezone: string;
  workWeekStarts: number;
  operatingHours: OperatingHours;
  staffing: StaffingDefaults;
};

export type SiteOperationalSettingsOverride = {
  timezone?: string | null;
  workWeekStarts?: number | null;
  operatingHours?: Partial<{ [Key in keyof OperatingHours]: OperatingHours[Key] | null }>;
  staffing?: Partial<{ [Key in keyof StaffingDefaults]: StaffingDefaults[Key] | null }>;
};

export type StaffImportInputRow = {
  sourceRow: string;
  externalKey: string;
  fullName: string;
  displayName?: string | null;
  employmentRole: string;
  siteId: string;
  effectiveFrom: string;
  primarySite?: boolean;
  email?: string | null;
};

export type StaffImportPreviewRow = {
  sourceRow: string;
  externalKey: string;
  organisationId: string;
  siteId: string;
  fullName: string;
  displayName: string;
  employmentRole: string;
  effectiveFrom: string;
  primarySite: boolean;
  email: string | null;
};

export type StaffImportErrorCode =
  | "missing_required_value"
  | "site_not_permitted"
  | "invalid_date"
  | "invalid_email"
  | "duplicate_email"
  | "duplicate_staff"
  | "duplicate_external_key";

export type StaffImportPreviewError = {
  sourceRow: string;
  code: StaffImportErrorCode;
  field: keyof StaffImportInputRow;
};

export type StaffImportPreview = {
  valid: boolean;
  rows: StaffImportPreviewRow[];
  errors: StaffImportPreviewError[];
};
