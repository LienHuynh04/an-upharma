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

  /**
   * Tải toàn bộ bộ nhớ đệm tồn kho từ Firebase Realtime Database.
   * Cách này nhanh hơn rất nhiều so với kiểm tra từng sản phẩm một.
   */
  async getAllCache(): Promise<Record<string, CacheEntry>> {
    if (!this.dbUrl) {
      console.warn("[Firebase Cache] firebaseDbUrl chưa được định nghĩa trong environment");
      return {};
    }

    try {
      const url = `${this.dbUrl}/national_inventory_cache.json`;
      console.log(`[Firebase Cache] Đang tải toàn bộ cache từ: ${url}`);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      return data || {};
    } catch (error) {
      console.error("[Firebase Cache] Lỗi khi tải toàn bộ cache:", error);
      return {};
    }
  }

  /**
   * Lưu thông tin tồn kho toàn quốc của một sản phẩm vào bộ nhớ đệm.
   */
  async saveCache(productID: string, shops: any[]): Promise<void> {
    if (!this.dbUrl) return;

    try {
      const url = `${this.dbUrl}/national_inventory_cache/${productID}.json`;
      const entry: CacheEntry = {
        productID,
        shops,
        updatedAt: Date.now(),
      };
      
      const response = await fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(entry),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      console.log(`[Firebase Cache] Đã lưu cache cho sản phẩm ${productID}`);
    } catch (error) {
      console.error(`[Firebase Cache] Lỗi khi lưu cache cho sản phẩm ${productID}:`, error);
    }
  }

  /**
   * Xóa toàn bộ bộ nhớ đệm trên Firebase.
   */
  async clearAllCache(): Promise<void> {
    if (!this.dbUrl) return;

    try {
      const url = `${this.dbUrl}/national_inventory_cache.json`;
      const response = await fetch(url, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      console.log("[Firebase Cache] Đã xóa toàn bộ bộ nhớ đệm trên Firebase");
    } catch (error) {
      console.error("[Firebase Cache] Lỗi khi xóa bộ nhớ đệm:", error);
      throw error;
    }
  }
}
