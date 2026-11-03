import type {
  FefoSummaryItem,
  InventoryExpiryItem,
  ReportLiveMetrics,
  ShopKpiItem,
} from "./report-generator.service";

/**
 * Chuẩn hoá một bản ghi ReportLiveMetrics đọc từ bên ngoài (Firebase RTDB / dữ liệu cũ).
 *
 * BỐI CẢNH BUG (2026-11-03): Firebase RTDB KHÔNG lưu mảng rỗng, object rỗng hay giá trị
 * null — khi PUT cấu hình báo cáo, các trường như
 * `nearExpiryOrders[shop].r3.employees = []` và `fefoStats[shop].empSummaries = []`
 * bị RTDB cắt bỏ hoàn toàn. Khi đọc lại, các trường đó thành `undefined`, và
 * `buildFullHtml()` gục ngay ở `employees.length` / `empSummaries.map` với lỗi
 * "Cannot read properties of undefined (reading 'length')" mỗi khi bấm Xem/Tải báo cáo.
 *
 * Hàm này là pure function (chỉ phụ thuộc type, không import runtime từ service)
 * để mọi đường vào — load cấu hình, xuất báo cáo — đều đi qua cùng một lớp vá:
 * thiếu trường nào thì lấp bằng giá trị mặc định đúng kiểu, KHÔNG bịa số liệu.
 */

type NearExpiryRange = { totalAmount: number; employees: { name: string; amount: number }[] };

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[];
  }
  // RTDB đôi khi trả mảng dưới dạng object có key số ("0", "1", ...) khi mảng
  // từng bị cắt phần tử ở giữa. Gặp dạng đó thì khôi phục lại thành mảng thật.
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => /^\d+$/.test(key))
      .sort(([a], [b]) => Number(a) - Number(b));
    if (entries.length > 0) {
      return entries.map(([, item]) => item as T);
    }
  }
  return [];
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeKpi(raw: unknown): ShopKpiItem {
  const item = asRecord(raw);
  return {
    salesTarget: asNumber(item["salesTarget"]),
    salesActual: asNumber(item["salesActual"]),
    salesPercent: asNumber(item["salesPercent"]),
    salesProjected: asNumber(item["salesProjected"]),
    hhsTarget: asNumber(item["hhsTarget"]),
    hhsActual: asNumber(item["hhsActual"]),
    hhsPercent: asNumber(item["hhsPercent"]),
    hhsProjected: asNumber(item["hhsProjected"]),
    hhsRatio: asNumber(item["hhsRatio"]),
  };
}

function normalizeInventory(raw: unknown): InventoryExpiryItem {
  const item = asRecord(raw);
  return {
    totalQty: asNumber(item["totalQty"]),
    totalVal: asNumber(item["totalVal"]),
    expiredCount: asNumber(item["expiredCount"]),
    expiredVal: asNumber(item["expiredVal"]),
    m3Count: asNumber(item["m3Count"]),
    m3Val: asNumber(item["m3Val"]),
    m6Count: asNumber(item["m6Count"]),
    m6Val: asNumber(item["m6Val"]),
    y1Count: asNumber(item["y1Count"]),
    y1Val: asNumber(item["y1Val"]),
    normalCount: asNumber(item["normalCount"]),
    normalVal: asNumber(item["normalVal"]),
  };
}

function normalizeFefo(raw: unknown): FefoSummaryItem {
  const item = asRecord(raw);
  return {
    totalLines: asNumber(item["totalLines"]),
    wrongCases: asNumber(item["wrongCases"]),
    errRate: typeof item["errRate"] === "string" && item["errRate"] ? item["errRate"] : "0,00%",
    affectedProds: asNumber(item["affectedProds"]),
    totalWrongQty: asNumber(item["totalWrongQty"]),
    dataLoadError: item["dataLoadError"] === true,
    empSummaries: asArray<any>(item["empSummaries"]).map((emp) => {
      const e = asRecord(emp);
      return {
        employeeName: String(e["employeeName"] ?? "Dược sĩ"),
        totalLines: asNumber(e["totalLines"]),
        wrongCases: asNumber(e["wrongCases"]),
        errRate: typeof e["errRate"] === "string" && e["errRate"] ? e["errRate"] : "0,00%",
        affectedProds: asNumber(e["affectedProds"]),
        totalWrongQty: asNumber(e["totalWrongQty"]),
      };
    }),
  };
}

function normalizeNearExpiryRange(raw: unknown): NearExpiryRange {
  const item = asRecord(raw);
  return {
    totalAmount: asNumber(item["totalAmount"]),
    employees: asArray<any>(item["employees"]).map((emp) => {
      const e = asRecord(emp);
      return { name: String(e["name"] ?? ""), amount: asNumber(e["amount"]) };
    }),
  };
}

/** Chuẩn hoá 1 bản ghi thu thập. Trả về null nếu đầu vào không phải object có dữ liệu. */
export function normalizeLiveMetrics(raw: unknown): ReportLiveMetrics | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const source = raw as Record<string, any>;
  const now = new Date();

  const shopKpis: Record<string, ShopKpiItem> = {};
  for (const [shopCode, value] of Object.entries(asRecord(source["shopKpis"]))) {
    shopKpis[shopCode] = normalizeKpi(value);
  }

  const inventoryStats: Record<string, InventoryExpiryItem> = {};
  for (const [shopCode, value] of Object.entries(asRecord(source["inventoryStats"]))) {
    inventoryStats[shopCode] = normalizeInventory(value);
  }

  const fefoStats: Record<string, FefoSummaryItem> = {};
  for (const [shopCode, value] of Object.entries(asRecord(source["fefoStats"]))) {
    fefoStats[shopCode] = normalizeFefo(value);
  }

  const employeePlans: ReportLiveMetrics["employeePlans"] = {};
  for (const [shopCode, value] of Object.entries(asRecord(source["employeePlans"]))) {
    employeePlans[shopCode] = asArray<any>(value).map((emp) => {
      const e = asRecord(emp);
      return {
        employeeCode: String(e["employeeCode"] ?? ""),
        employeeName: String(e["employeeName"] ?? "Nhân viên"),
        targetAmount: asNumber(e["targetAmount"]),
        actualAmount: asNumber(e["actualAmount"]),
        targetPoint: asNumber(e["targetPoint"]),
        actualPoint: asNumber(e["actualPoint"]),
        quantityCus: asNumber(e["quantityCus"]),
        quantityCusNew: asNumber(e["quantityCusNew"]),
        quantityInvoice: asNumber(e["quantityInvoice"]),
      };
    });
  }

  const nearExpiryOrders: NonNullable<ReportLiveMetrics["nearExpiryOrders"]> = {};
  for (const [shopCode, value] of Object.entries(asRecord(source["nearExpiryOrders"]))) {
    const ranges = asRecord(value);
    nearExpiryOrders[shopCode] = {
      r3: normalizeNearExpiryRange(ranges["r3"]),
      r6: normalizeNearExpiryRange(ranges["r6"]),
      r12: normalizeNearExpiryRange(ranges["r12"]),
    };
  }

  return {
    collectedAt:
      typeof source["collectedAt"] === "string" && source["collectedAt"]
        ? source["collectedAt"]
        : now.toISOString(),
    month: asNumber(source["month"], now.getMonth() + 1),
    year: asNumber(source["year"], now.getFullYear()),
    shopKpis,
    inventoryStats,
    fefoStats,
    employeePlans,
    nearExpiryOrders,
  };
}

/**
 * Chuẩn hoá danh sách lịch sử thu thập: loại bản ghi hỏng, sắp xếp mới nhất trước,
 * giới hạn số lượng để payload Firebase không phình vô hạn.
 */
export function normalizeMetricsHistory(
  rawHistory: unknown,
  activeMetrics: unknown,
  maxEntries = 20,
): ReportLiveMetrics[] {
  const history: ReportLiveMetrics[] = [];
  const seen = new Set<string>();

  const pushUnique = (metrics: ReportLiveMetrics | null): void => {
    if (!metrics || seen.has(metrics.collectedAt)) {
      return;
    }
    seen.add(metrics.collectedAt);
    history.push(metrics);
  };

  for (const entry of asArray<unknown>(rawHistory)) {
    pushUnique(normalizeLiveMetrics(entry));
  }

  // Tương thích ngược: cấu hình cũ chỉ có 1 liveMetrics, chưa có history —
  // tự động đưa bản ghi đó thành phần tử đầu tiên của lịch sử.
  pushUnique(normalizeLiveMetrics(activeMetrics));

  history.sort((a, b) => String(b.collectedAt).localeCompare(String(a.collectedAt)));
  return history.slice(0, maxEntries);
}
