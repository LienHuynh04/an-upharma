import { Injectable } from "@angular/core";
import { environment } from "../environments/environment";

/**
 * Cấu hình ẩn/hiện nhà thuốc — MỘT nguồn sự thật duy nhất cho cả app và cronjob.
 *
 * Firebase RTDB: `hidden_products/shop_visibility`
 *
 * LƯU Ý VỀ ĐƯỜNG DẪN: RTDB rules của dự án khóa ghi ở root và chỉ mở ghi
 * công khai tại `hidden_products` và `transfer_suggestions_cache` (xem
 * database.rules.json) — node `settings/...` bị từ chối HTTP 401 khi PUT.
 * Vì vậy cấu hình này nằm dưới `hidden_products` (cùng chỗ với
 * report_config_<id> của trang Báo cáo vẫn lưu bình thường), KHÔNG chuyển
 * về `settings/...` trừ khi rules trên Firebase console được mở thêm.
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
 *
 * Hai kho SHOP0040 / SHOP0162 (trước đây bị loại cứng bằng
 * environment.excludedShopCodes + UPHARMA_EXCLUDED_SHOPS) nay cũng do cấu
 * hình này quản lý như mọi shop khác. Để hành vi không đổi đột ngột,
 * chúng nằm trong DEFAULT_HIDDEN_SHOP_CODES: khi CHƯA có cấu hình nào được
 * lưu trên Firebase thì chúng vẫn ẩn như cũ; ngay khi user lưu cấu hình lần
 * đầu (trang Cài đặt luôn khởi tạo trạng thái gạt từ danh sách hiệu lực,
 * gồm cả mặc định), tài liệu đã lưu là nguồn sự thật duy nhất và user bật
 * lại kho lúc nào cũng được.
 */

export interface ShopVisibilityConfig {
  hiddenShopCodes: string[];
  updatedAt?: string;
  updatedBy?: string;
  /** true khi đây là cấu hình mặc định suy ra vì Firebase chưa có tài liệu nào. */
  isDefault?: boolean;
}

export const SHOP_VISIBILITY_PATH = "hidden_products/shop_visibility";
const SHOP_VISIBILITY_CACHE_KEY = "upharma_shop_visibility";
/** Cờ "đã có cấu hình thật trên Firebase" — phân biệt với trạng thái chưa từng lưu. */
const SHOP_VISIBILITY_SAVED_KEY = "upharma_shop_visibility_saved";

/**
 * Các shop ẩn theo mặc định CHỈ KHI chưa có cấu hình nào được lưu: hai kho
 * từng bị loại cứng (SHOP0040, SHOP0162). User bật lại được trong trang
 * Cài đặt; ngay lần lưu đầu tiên, tài liệu trên Firebase là nguồn sự thật
 * duy nhất và danh sách mặc định này không còn tác dụng.
 */
export const DEFAULT_HIDDEN_SHOP_CODES: readonly string[] = ["SHOP0040", "SHOP0162"];

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

/**
 * Đọc danh sách shop đang ẩn theo trạng thái đồng bộ hiện tại:
 * - Đã có cấu hình thật (đã đọc được từ Firebase hoặc đã lưu): dùng danh
 *   sách trong cache — kể cả khi rỗng (user đã chủ động hiện tất cả).
 * - Chưa từng có cấu hình: dùng DEFAULT_HIDDEN_SHOP_CODES (hai kho vẫn ẩn
 *   như thời còn loại cứng, phần còn lại hiện hết).
 */
export function readCachedHiddenShopCodes(): string[] {
  try {
    if (localStorage.getItem(SHOP_VISIBILITY_SAVED_KEY) === "1") {
      const raw = localStorage.getItem(SHOP_VISIBILITY_CACHE_KEY);
      if (!raw) return [];
      return normalizeHiddenShopCodes(JSON.parse(raw));
    }
    return [...DEFAULT_HIDDEN_SHOP_CODES];
  } catch {
    return [...DEFAULT_HIDDEN_SHOP_CODES];
  }
}

/** Shop này có đang bị ẩn theo cấu hình hiển thị hiện hành không (đọc đồng bộ). */
export function isShopHiddenByVisibility(shopCode: unknown): boolean {
  const code = String(shopCode ?? "").trim().toUpperCase();
  if (!code) return false;
  return readCachedHiddenShopCodes().some((hidden) => hidden.toUpperCase() === code);
}

function writeCachedConfig(config: ShopVisibilityConfig, markSaved: boolean): void {
  try {
    localStorage.setItem(SHOP_VISIBILITY_CACHE_KEY, JSON.stringify(config));
    if (markSaved) {
      localStorage.setItem(SHOP_VISIBILITY_SAVED_KEY, "1");
    }
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
   * - Có tài liệu: cache lại + đánh dấu đã có cấu hình thật, trả về tài liệu.
   * - Chưa có tài liệu (null): trả về cấu hình MẶC ĐỊNH (ẩn hai kho) với
   *   isDefault=true, không đánh dấu đã lưu.
   * - Đọc lỗi: trả về null — caller giữ nguyên trạng thái đồng bộ hiện tại.
   */
  async refreshFromFirebase(): Promise<ShopVisibilityConfig | null> {
    if (!this.firebaseDbUrl) return null;
    try {
      const response = await fetch(`${this.firebaseDbUrl}/${SHOP_VISIBILITY_PATH}.json`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return null;
      const raw = await response.json();
      if (raw === null || raw === undefined) {
        const fallback: ShopVisibilityConfig = {
          hiddenShopCodes: [...DEFAULT_HIDDEN_SHOP_CODES],
          isDefault: true,
        };
        writeCachedConfig(fallback, false);
        return fallback;
      }
      const config = normalizeShopVisibilityConfig(raw);
      writeCachedConfig(config, true);
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
    writeCachedConfig(config, true);
    return config;
  }

  /** Áp dụng cấu hình ẩn lên danh sách shop (dùng cache đồng bộ). */
  applyToShops<T extends { ShopCode: string }>(shops: readonly T[]): T[] {
    return filterVisibleShops(shops, readCachedHiddenShopCodes());
  }
}
