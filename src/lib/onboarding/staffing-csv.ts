import { createHash } from "node:crypto";
import { staffImportUploadPayloadSchema } from "./staffing-contracts";

export const STAFFING_CSV_MAX_BYTES = 1_048_576;
export const STAFFING_CSV_MAX_ROWS = 250;
export const STAFFING_CSV_HEADERS = ["external_staff_id", "full_name", "display_name", "email", "employment_status", "start_date", "job_role", "primary_site", "attendance_eligible"] as const;

export type StaffingCsvFile = { name: string; type: string; size: number; text(): Promise<string> };

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (quoted) throw new Error("malformed_csv");
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows.filter((candidate) => candidate.some((value) => value.trim() !== ""));
}

function booleanValue(value: string): boolean | string {
  if (/^(yes|true|1)$/i.test(value.trim())) return true;
  if (/^(no|false|0)$/i.test(value.trim())) return false;
  return value.trim();
}

export async function parseStaffingCsv(file: StaffingCsvFile) {
  if (!/\.csv$/i.test(file.name) || !["text/csv", "application/csv", "application/vnd.ms-excel", ""].includes(file.type)) throw new Error("invalid_file_type");
  if (file.size <= 0) throw new Error("empty_file");
  if (file.size > STAFFING_CSV_MAX_BYTES) throw new Error("file_too_large");
  const text = await file.text(); const parsed = parseCsv(text.replace(/^\uFEFF/, ""));
  if (!parsed.length) throw new Error("empty_file");
  const headers = parsed[0].map((value) => value.trim().toLowerCase());
  if (headers.join("|") !== STAFFING_CSV_HEADERS.join("|")) throw new Error("invalid_headers");
  if (parsed.length - 1 > STAFFING_CSV_MAX_ROWS) throw new Error("too_many_rows");
  const rows = parsed.slice(1).map((values, index) => {
    if (values.length !== STAFFING_CSV_HEADERS.length) throw new Error("malformed_csv");
    const [externalStaffId, fullName, displayName, email, employmentStatus, startDate, jobRole, siteName, attendanceEligible] = values.map((value) => value.trim());
    if (/^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(startDate)) throw new Error("ambiguous_date");
    return { sourceRowNumber: index + 2, externalStaffId, fullName, displayName: displayName || fullName.split(/\s+/)[0], email,
      employmentStatus, startDate, jobRole, siteName, attendanceEligible: booleanValue(attendanceEligible) };
  });
  const payload = staffImportUploadPayloadSchema.parse({ safeFilename: file.name.replace(/[^A-Za-z0-9._ -]/g, "_"), fileDigest: createHash("sha256").update(text).digest("hex"), rows });
  return payload;
}
