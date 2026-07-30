import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const expected = [
  [
    "20260723162038_staff_lifecycle_management.sql",
    2017,
    "f507abecf62cdc33fb2efceea1a886dfbfb7945d5e4e8fdb7a1c16468ebe270e",
  ],
  [
    "20260723162052_enforce_staff_lifecycle_paths.sql",
    2082,
    "2044620d93a564ec91147e0aaba77a3fbf6babc94d492f29eeceef931ec5a192",
  ],
  [
    "20260728230702_clock_event_corrections.sql",
    53926,
    "2a4f5de2097d8f01c3e410ebc8fd4a401bca9d7698562721888da4c13df95ff8",
  ],
  [
    "20260728230820_revoke_clock_correction_trigger_execute.sql",
    104,
    "a15be1be659fbb344a0d41fd6b3eaa15fac7e7c9953264f8e31da476ab0758c5",
  ],
  [
    "20260729015320_attendance_remove_and_reset.sql",
    13664,
    "0423430a8c8e537e64690812b8f6e10135b85f68c03e76466d30977bb7864f28",
  ],
] as const;

describe("production migration history", () => {
  it.each(expected)(
    "%s matches the production statement exactly",
    (file, bytes, sha256) => {
      const sql = readFileSync(resolve("supabase/migrations", file), "utf8")
        .replaceAll("\r\n", "\n")
        .replace(/[\r\n]+$/, "");

      expect(Buffer.byteLength(sql, "utf8")).toBe(bytes);
      expect(createHash("sha256").update(sql, "utf8").digest("hex")).toBe(
        sha256,
      );
    },
  );
});
