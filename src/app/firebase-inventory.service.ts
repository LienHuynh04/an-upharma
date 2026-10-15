import { Injectable } from "@angular/core";
import { environment } from "../environments/environment";
import { sanitizeFirebaseKey } from "./firebase-key.utils";

export interface CacheEntry {
  productID: string;
  shops: any[];
  updatedAt: number; // timestamp in ms
}

@Injectable({
  providedIn: "root",
})
export class FirebaseInventoryService {
  private get dbUrl(): string {
    const url = (environment as any).firebaseDbUrl || "";
    return url.replace(/\/$/, "");
  }

  constructor() {}

  /**
   * Tải toàn bộ bộ nhớ đệm tồn kho toàn quốc từ Firebase Realtime Database.
   */
  async getAllCache(): Promise<Record<string, CacheEntry>> {
    if (!this.dbUrl) return {};

    try {
      const url = `${this.dbUrl}/national_inventory_cache.json`;
      console.log(`[Firebase Cache] Đang tải toàn bộ national_inventory_cache: ${url}`);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      return data || {};
    } catch (error) {
      console.warn("[Firebase Cache] Lỗi khi tải toàn bộ national_inventory_cache:", error);
      return {};
    }
  }

  /**
   * Tải bộ nhớ đệm tồn kho của MỘT sản phẩm cụ thể (On-Demand Fetch - Siêu nhẹ ~2KB).
   */
  async getProductCache(productID: string): Promise<CacheEntry | null> {
    if (!this.dbUrl || !productID) return null;

    try {
      const sanitized = sanitizeFirebaseKey(productID);
      const url = `${this.dbUrl}/national_inventory_cache/${sanitized}.json`;
      const response = await fetch(url);
      if (!response.ok) return null;

      const data = await response.json();
      return data as CacheEntry;
    } catch (error) {
      return null;
    }
  }

  /**
   * Tải bộ nhớ đệm tồn kho của DANH SÁCH sản phẩm cụ thể song song (Batch On-Demand Fetch).
   */
  async getBatchCache(productIDs: string[]): Promise<Record<string, CacheEntry>> {
    if (!this.dbUrl || !productIDs || productIDs.length === 0) return {};

    const results: Record<string, CacheEntry> = {};
    const uniqueCodes = Array.from(new Set(productIDs.map((id) => id.trim())));

    const CHUNK_SIZE = 25;
    for (let i = 0; i < uniqueCodes.length; i += CHUNK_SIZE) {
      const chunk = uniqueCodes.slice(i, i + CHUNK_SIZE);
      await Promise.all(
        chunk.map(async (code) => {
          const entry = await this.getProductCache(code);
          if (entry && Array.isArray(entry.shops)) {
            results[code] = entry;
          }
        })
      );
    }

    return results;
  }

  /**
   * Lưu thông tin tồn kho toàn quốc của một sản phẩm vào bộ nhớ đệm Firebase.
   */
  async saveCache(productID: string, shops: any[]): Promise<void> {
    if (!this.dbUrl || !productID) return;

    try {
      const sanitized = sanitizeFirebaseKey(productID);
      const url = `${this.dbUrl}/national_inventory_cache/${sanitized}.json`;
      const entry: CacheEntry = {
        productID: sanitized,
        shops,
        updatedAt: Date.now(),
      };

      const response = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      console.warn(`[Firebase Cache] Lỗi khi lưu cache cho sản phẩm ${productID}:`, error);
    }
  }

  /**
   * Tải dữ liệu Gợi ý Điều Chuyển Hàng Cận Date ĐÃ ĐƯỢC TÍNH SẴN từ Firebase Server cho 1 Nhà Thuốc.
   * Dung lượng siêu nhẹ (~20KB), tải trong 30ms.
   */
  async getShopTransferSuggestions(shopCode: string): Promise<any | null> {
    if (!this.dbUrl || !shopCode) return null;

    try {
      const sanitized = sanitizeFirebaseKey(shopCode);
      const url = `${this.dbUrl}/transfer_suggestions_cache/${sanitized}.json`;
      console.log(`[Firebase Cache] Đang tải gợi ý tính sẵn cho shop ${shopCode}: ${url}`);
      const response = await fetch(url);
      if (!response.ok) return null;

      const data = await response.json();
      return data || null;
    } catch (error) {
      console.warn(`[Firebase Cache] Không lấy được transfer_suggestions_cache cho ${shopCode}:`, error);
      return null;
    }
  }

  /**
   * Lưu dữ liệu gợi ý điều chuyển tính sẵn cho 1 nhà thuốc lên Firebase.
   */
  async saveShopTransferSuggestions(shopCode: string, suggestionsData: any): Promise<void> {
    if (!this.dbUrl || !shopCode) return;

    try {
      const sanitized = sanitizeFirebaseKey(shopCode);
      const url = `${this.dbUrl}/transfer_suggestions_cache/${sanitized}.json`;
      const payload = {
        shopCode,
        updatedAt: Date.now(),
        ...suggestionsData,
      };

      await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.error(`[Firebase Cache] Lỗi khi lưu transfer_suggestions_cache cho shop ${shopCode}:`, error);
    }
  }

  /**
   * Tải danh mục sản phẩm toàn hệ thống /product_catalog.json từ Firebase Realtime Database.
   */
  async getProductCatalog(): Promise<{ items: { c: string; n: string; u: string }[]; updatedAt?: number } | null> {
    if (!this.dbUrl) return null;

    try {
      const url = `${this.dbUrl}/product_catalog.json`;
      console.log(`[Firebase Cache] Đang tải danh mục sản phẩm từ: ${url}`);
      const response = await fetch(url);
      if (!response.ok) return null;

      const data = await response.json();
      return data || null;
    } catch (error) {
      console.warn("[Firebase Cache] Lỗi khi tải product_catalog từ Firebase:", error);
      return null;
    }
  }
}
