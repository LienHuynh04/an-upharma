import { Injectable } from "@angular/core";
import { environment } from "../environments/environment";

/**
 * Cấu hình ẩn/hiện nhà thuốc — MỘT nguồn sự thật duy nhất cho cả app và cronjob.
 *
 * Firebase RTDB: `settings/shop_visibility`
 * ```json
 * { "hiddenShopCodes": ["SHOP0123"], "updatedAt": "<ISO>", "updatedBy": "841" }
 * ```
 *
 * Thiết kế opt-out (chỉ lưu danh sách ẨN):
 * - Shop không có trong danh sách = đang hiện. Shop mới xuất hiện trong tài khoản
 *   sẽ tự hiện, không cần ai vào cài đặt mở lên.
 * - App lọc tại đúng 1 điểm chạm: `UpharmaService.getActiveShops()` — mọi trang
 *   đang gọi hàm đó nên tự động tôn trọng cấu hình, không phải sửa từng trang.
 * - Cronjob (scripts/fetch-upharma-data.js) đọc cùng node này trước khi sync và
 *   chỉ gọi API cho shop đang hiện.
 * - Mọi lỗi đọc cấu hình đều FAIL-OPEN (coi như hiện tất cả): một lỗi Firebase
 *   không bao giờ được làm app mất shop hoặc làm cron ngừng đồng bộ.
 */

export interface ShopVisibilityConfig {
  hiddenShopCodes: string[];
  updatedAt?: string;
  updatedBy?: string;
}

export const SHOP_VISIBILITY_PATH = "settings/shop_visibility";
const SHOP_VISIBILITY_CACHE_KEY = "upharma_shop_visibility";

/** Chuẩn hoá dữ liệu thô từ Firebase/localStorage thành danh sách mã shop bị ẩn. */
export function normalizeHiddenShopCodes(raw: unknown): string[] {
  const codes = new Set<string>();
  const collect = (value: unknown): void => {
    if (typeof value === "string" && value.trim()) {
      codes.add(value.trim());
    }
  };

  if (Array.isArray(raw)) {
    raw.forEach(collect);
  } else if (raw && typeof raw === "object") {
    const doc = raw as Record<string, unknown>;
    if (Array.isArray(doc["hiddenShopCodes"])) {
      doc["hiddenShopCodes"].forEach(collect);
    } else if (doc["hiddenShopCodes"] && typeof doc["hiddenShopCodes"] === "object") {
      // RTDB có thể trả mảng dưới dạng object key số — lấy value dạng chuỗi.
      Object.values(doc["hiddenShopCodes"]).forEach(collect);
    }
    // Dạng map { SHOPxxxx: true } (giống allowed_shops) cũng được chấp nhận.
    if (doc["hiddenShops"] && typeof doc["hiddenShops"] === "object") {
      for (const [code, flag] of Object.entries(doc["hiddenShops"] as Record<string, unknown>)) {
        if (flag === true) collect(code);
      }
    }
  }

  return [...codes].sort((a, b) => a.localeCompare(b));
}

export function normalizeShopVisibilityConfig(raw: unknown): ShopVisibilityConfig {
  const doc = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    hiddenShopCodes: normalizeHiddenShopCodes(raw),
    updatedAt: typeof doc["updatedAt"] === "string" ? doc["updatedAt"] : undefined,
    updatedBy: typeof doc["updatedBy"] === "string" ? doc["updatedBy"] : undefined,
  };
}

/** Lọc danh sách shop theo cấu hình ẩn — pure function, dùng cho cả app và test. */
export function filterVisibleShops<T extends { ShopCode: string }>(
  shops: readonly T[],
  hiddenShopCodes: readonly string[],
): T[] {
  if (!hiddenShopCodes || hiddenShopCodes.length === 0) {
    return [...shops];
  }
  const hidden = new Set(hiddenShopCodes);
  return shops.filter((shop) => !hidden.has(shop.ShopCode));
}

/** Đọc cache đồng bộ từ localStorage (không có cache → không ẩn shop nào). */
export function readCachedHiddenShopCodes(): string[] {
  try {
    const raw = localStorage.getItem(SHOP_VISIBILITY_CACHE_KEY);
    if (!raw) return [];
    return normalizeHiddenShopCodes(JSON.parse(raw));
  } catch {
    return [];
  }
}

function writeCachedConfig(config: ShopVisibilityConfig): void {
  try {
    localStorage.setItem(SHOP_VISIBILITY_CACHE_KEY, JSON.stringify(config));
  } catch {
    // localStorage đầy/không khả dụng: bỏ qua, lần tải sau sẽ đọc lại Firebase.
  }
}

@Injectable({ providedIn: "root" })
export class ShopVisibilityService {
  private get firebaseDbUrl(): string {
    const url = (environment as any).firebaseDbUrl || "";
    return String(url).replace(/\/$/, "");
  }

  /** Danh sách shop đang bị ẩn theo cache đồng bộ — dùng trong getActiveShops(). */
  getHiddenShopCodesSync(): string[] {
    return readCachedHiddenShopCodes();
  }

  isShopVisibleSync(shopCode: string): boolean {
    return !readCachedHiddenShopCodes().includes(shopCode);
  }

  /**
   * Đọc cấu hình mới nhất từ Firebase và cập nhật cache đồng bộ.
   * Trả về null nếu đọc lỗi — caller giữ nguyên cache cũ (fail-open theo cache).
   */
  async refreshFromFirebase(): Promise<ShopVisibilityConfig | null> {
    if (!this.firebaseDbUrl) return null;
    try {
      const response = await fetch(`${this.firebaseDbUrl}/${SHOP_VISIBILITY_PATH}.json`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return null;
      const config = normalizeShopVisibilityConfig(await response.json());
      writeCachedConfig(config);
      return config;
    } catch (error) {
      console.warn("Không đọc được cấu hình ẩn/hiện nhà thuốc từ Firebase:", error);
      return null;
    }
  }

  /** Lưu cấu hình lên Firebase + cache. Ném lỗi ra ngoài để UI báo cho user. */
  async saveToFirebase(hiddenShopCodes: string[], updatedBy: string): Promise<ShopVisibilityConfig> {
    const config: ShopVisibilityConfig = {
      hiddenShopCodes: normalizeHiddenShopCodes(hiddenShopCodes),
      updatedAt: new Date().toISOString(),
      updatedBy,
    };
    if (!this.firebaseDbUrl) {
      throw new Error("Chưa cấu hình Firebase Database URL");
    }
    const response = await fetch(`${this.firebaseDbUrl}/${SHOP_VISIBILITY_PATH}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify(config),
    });
    if (!response.ok) {
      throw new Error(`Firebase RTDB trả về HTTP ${response.status}`);
    }
    writeCachedConfig(config);
    return config;
  }

  /** Áp dụng cấu hình ẩn lên danh sách shop (dùng cache đồng bộ). */
  applyToShops<T extends { ShopCode: string }>(shops: readonly T[]): T[] {
    return filterVisibleShops(shops, readCachedHiddenShopCodes());
  }
}
