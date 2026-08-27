import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { readFirstWorksheetRows } from "@/lib/exports/workbook-reader";

async function workbookBuffer(rows: unknown[][]): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Sheet 1").addRows(rows);
  return (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
}

describe("safe workbook reader", () => {
  it("returns values from the first worksheet", async () => {
    const rows = await readFirstWorksheetRows(
      await workbookBuffer([
        ["Staff", "Example Person"],
        ["Rate", 12.5],
      ]),
    );

    expect(rows).toEqual([
      ["Staff", "Example Person"],
      ["Rate", 12.5],
    ]);
  });

  it("rejects workbooks that exceed the supported row limit", async () => {
    const rows = Array.from({ length: 2_001 }, (_, index) => [index]);

    await expect(readFirstWorksheetRows(await workbookBuffer(rows))).rejects.toThrow(
      "more than 2000 rows",
    );
  });

  it("rejects workbooks that exceed the supported column limit", async () => {
    const row = Array.from({ length: 201 }, (_, index) => index);

    await expect(readFirstWorksheetRows(await workbookBuffer([row]))).rejects.toThrow(
      "more than 200 columns",
    );
  });
});
