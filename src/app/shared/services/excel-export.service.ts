import { Injectable } from "@angular/core";

@Injectable({
  providedIn: "root",
})
export class ExcelExportService {
  /**
   * Export an array of objects to an Excel (.xlsx) file and trigger browser download.
   * Dynamically imports the 'xlsx' library to preserve initial bundle size.
   */
  async exportJsonToExcel(
    data: Record<string, any>[],
    fileName: string,
    sheetName = "Sheet1"
  ): Promise<void> {
    if (!data || data.length === 0) {
      return;
    }

    const xlsx = await import("xlsx-js-style");
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.json_to_sheet(data);

    xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);

    const buffer = xlsx.write(workbook, {
      bookType: "xlsx",
      type: "array",
    }) as ArrayBuffer;

    this.downloadBuffer(buffer, fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`);
  }

  /**
   * Export several named sheets into ONE .xlsx file and trigger download.
   * Sheets with no rows are written with a single placeholder row so the
   * sheet still exists in the file.
   */
  async exportSheetsToExcel(
    sheets: { name: string; data: Record<string, any>[]; highlightRows?: number[] }[],
    fileName: string
  ): Promise<void> {
    // xlsx-js-style is a drop-in fork of SheetJS that also WRITES cell
    // styles (the community build silently drops them); needed so review
    // exports can paint rows light red.
    const xlsx = await import("xlsx-js-style");
    const workbook = xlsx.utils.book_new();
    for (const sheet of sheets) {
      const rows = sheet.data.length ? sheet.data : [{ "Thông tin": "Không có dữ liệu." }];
      const worksheet = xlsx.utils.json_to_sheet(rows);
      if (sheet.data.length && sheet.highlightRows?.length) {
        // Classic Excel "light red fill, dark red text" for flagged rows.
        const highlightStyle = {
          fill: {
            patternType: "solid",
            fgColor: { rgb: "FFFFC7CE" },
            bgColor: { rgb: "FFFFC7CE" },
          },
          font: { color: { rgb: "FF9C0006" } },
        };
        const range = xlsx.utils.decode_range(worksheet["!ref"] ?? "A1");
        for (const rowIndex of sheet.highlightRows) {
          const sheetRow = rowIndex + 1; // row 0 is the header row
          if (sheetRow > range.e.r) continue;
          for (let col = range.s.c; col <= range.e.c; col++) {
            const address = xlsx.utils.encode_cell({ r: sheetRow, c: col });
            const cell = (worksheet[address] ??= { t: "s", v: "" } as any);
            (cell as any).s = highlightStyle;
          }
        }
      }
      xlsx.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
    }
    const buffer = xlsx.write(workbook, {
      bookType: "xlsx",
      type: "array",
    }) as ArrayBuffer;
    this.downloadBuffer(buffer, fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`);
  }

  private downloadBuffer(buffer: ArrayBuffer, fileName: string): void {
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = fileName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
