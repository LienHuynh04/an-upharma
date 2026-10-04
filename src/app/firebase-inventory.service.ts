import { Injectable } from "@angular/core";
import { environment } from "../environments/environment";

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

  async getAllCache(): Promise<Record<string, CacheEntry>> {
    return {};
  }

  async getBatchCache(_productIDs: string[]): Promise<Record<string, CacheEntry>> {
    return {};
  }



  /**
   * Tải dữ liệu Gợi ý Điều Chuyển Hàng Cận Date ĐÃ ĐƯỢC TÍNH SẴN từ Firebase Server cho 1 Nhà Thuốc.
   * Dung lượng siêu nhẹ (~20KB), tải trong 30ms.
   */
  async getShopTransferSuggestions(shopCode: string): Promise<any | null> {
    if (!this.dbUrl || !shopCode) return null;

    try {
      const sanitized = shopCode.trim().replace(/[.$#\[\]\/]/g, "_");
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
      const sanitized = shopCode.trim().replace(/[.$#\[\]\/]/g, "_");
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
