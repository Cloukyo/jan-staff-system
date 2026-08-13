import { describe, expect, it } from "vitest";
import { parseStaffingCsv, STAFFING_CSV_HEADERS, STAFFING_CSV_MAX_BYTES } from "@/lib/onboarding/staffing-csv";

const header = STAFFING_CSV_HEADERS.join(",");
function file(text: string, name = "fictional-staff.csv", type = "text/csv") { return { name, type, size: Buffer.byteLength(text), async text() { return text; } }; }

describe("commercial onboarding staffing CSV", () => {
  it("normalises a bounded fictional CSV with explicit eligibility", async () => {
    const result = await parseStaffingCsv(file(`${header}\nEMP-001,Alex Morgan,Alex,alex@example.invalid,active,2026-09-01,staff,,yes`));
    expect(result.rows[0]).toMatchObject({ externalStaffId: "EMP-001", fullName: "Alex Morgan", attendanceEligible: true, sourceRowNumber: 2 });
    expect(result.fileDigest).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([
    ["bad.exe", "text/csv", "invalid_file_type"], ["bad.csv", "application/octet-stream", "invalid_file_type"],
  ])("rejects unsafe file metadata", async (name, type, code) => expect(parseStaffingCsv(file(header, name, type))).rejects.toThrow(code));
  it("rejects oversized uploads before reading their contents", async () => {
    await expect(parseStaffingCsv({ name: "fictional.csv", type: "text/csv", size: STAFFING_CSV_MAX_BYTES + 1, async text() { throw new Error("must not read"); } })).rejects.toThrow("file_too_large");
  });
  it("rejects empty, malformed and ambiguous input while preserving row-level eligibility errors for review", async () => {
    await expect(parseStaffingCsv(file(""))).rejects.toThrow("empty_file");
    await expect(parseStaffingCsv(file(`${header}\n\"unclosed`))).rejects.toThrow("malformed_csv");
    await expect(parseStaffingCsv(file(`${header}\nE1,Jamie Patel,Jamie,,active,01/09/2026,staff,,yes`))).rejects.toThrow("ambiguous_date");
    await expect(parseStaffingCsv(file(`${header}\nE1,Jamie Patel,Jamie,,active,2026-09-01,staff,,maybe`))).resolves.toMatchObject({ rows: [{ attendanceEligible: "maybe" }] });
    await expect(parseStaffingCsv(file(`${header}\nE1,Jamie Patel,Jamie,not-an-email,active,2026-09-01,unsupported,,yes`))).resolves.toMatchObject({ rows: [{ email: "not-an-email", jobRole: "unsupported" }] });
  });
  it("rejects more than 250 rows", async () => {
    const rows = Array.from({ length: 251 }, (_, index) => `E${index},Casey Taylor,Casey,,active,2026-09-01,staff,,no`);
    await expect(parseStaffingCsv(file(`${header}\n${rows.join("\n")}`))).rejects.toThrow("too_many_rows");
  });
});
