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

    const xlsx = await import("xlsx");
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.json_to_sheet(data);

    xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);

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
