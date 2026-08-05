import ExcelJS from "exceljs";

const MAX_WORKSHEETS = 20;
const MAX_ROWS = 2_000;
const MAX_COLUMNS = 200;

function plainCellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date || typeof value !== "object") return value;
  if ("result" in value) return value.result ?? null;
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("text" in value) return value.text;
  if ("error" in value) return value.error;
  return null;
}

export async function readFirstWorksheetRows(buffer: ArrayBuffer): Promise<unknown[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  if (workbook.worksheets.length > MAX_WORKSHEETS) {
    throw new Error(`The workbook contains more than ${MAX_WORKSHEETS} worksheets.`);
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("The workbook does not contain a worksheet.");
  if (sheet.rowCount > MAX_ROWS) {
    throw new Error(`The first worksheet contains more than ${MAX_ROWS} rows.`);
  }
  if (sheet.columnCount > MAX_COLUMNS) {
    throw new Error(`The first worksheet contains more than ${MAX_COLUMNS} columns.`);
  }

  return Array.from({ length: sheet.rowCount }, (_, rowIndex) =>
    Array.from({ length: sheet.columnCount }, (_, columnIndex) =>
      plainCellValue(sheet.getCell(rowIndex + 1, columnIndex + 1).value),
    ),
  );
}
