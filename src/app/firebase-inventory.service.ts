import { Injectable } from "@angular/core";
import { environment } from "../environments/environment";
import { isExcludedShopCode } from "./excluded-shops.utils";
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
  private readonly requestTimeoutMs = 30_000;

  private get dbUrl(): string {
    const url = (environment as any).firebaseDbUrl || "";
    return url.replace(/\/$/, "");
  }

  constructor() {}

  private async withRequestTimeout<T>(
    request: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      return await request(controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Firebase: hết thời gian chờ sau ${this.requestTimeoutMs / 1000} giây`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Tải toàn bộ bộ nhớ đệm tồn kho toàn quốc từ Firebase Realtime Database.
   */
  async getAllCache(): Promise<Record<string, CacheEntry>> {
    if (!this.dbUrl) return {};

    try {
      const url = `${this.dbUrl}/national_inventory_cache.json`;
      console.log(`[Firebase Cache] Đang tải toàn bộ national_inventory_cache: ${url}`);
      const data = await this.withRequestTimeout(async (signal) => {
        const response = await fetch(url, { signal });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      });
      return Object.fromEntries(
        Object.entries(data || {}).map(([productID, entry]: [string, any]) => [
          productID,
          this.filterCacheEntry(entry),
        ])
      );
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
      const data = await this.withRequestTimeout(async (signal) => {
        const response = await fetch(url, { signal });
        if (!response.ok) return null;
        return response.json();
      });
      return this.filterCacheEntry(data);
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
        shops: shops.filter((shop) => !isExcludedShopCode(shop?.StoreCode || shop?.ShopCode)),
        updatedAt: Date.now(),
      };

      const response = await this.withRequestTimeout((signal) => fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
        signal,
      }));

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
    if (!this.dbUrl || !shopCode || isExcludedShopCode(shopCode)) return null;

    try {
      const sanitized = sanitizeFirebaseKey(shopCode);
      const url = `${this.dbUrl}/transfer_suggestions_cache/${sanitized}.json`;
      console.log(`[Firebase Cache] Đang tải gợi ý tính sẵn cho shop ${shopCode}: ${url}`);
      const data = await this.withRequestTimeout(async (signal) => {
        const response = await fetch(url, { signal });
        if (!response.ok) return null;
        return response.json();
      });
      if (!data) return null;

      const filtered = { ...data };
      if (Array.isArray(filtered.expiringStockList)) {
        filtered.expiringStockList = filtered.expiringStockList.filter(
          (item: any) => !isExcludedShopCode(item?.shopCode || item?.ShopCode)
        );
      }
      if (Array.isArray(filtered.suggestions)) {
        filtered.suggestions = filtered.suggestions.filter(
          (item: any) =>
            !isExcludedShopCode(item?.fromShopCode || item?.FromShopCode) &&
            !isExcludedShopCode(item?.toShopCode || item?.ToShopCode)
        );
      }
      if (Array.isArray(filtered.groupedSuggestions)) {
        filtered.groupedSuggestions = filtered.groupedSuggestions.flatMap((group: any) => {
          if (isExcludedShopCode(group?.fromShopCode || group?.FromShopCode)) return [];
          const items = Array.isArray(group?.items)
            ? group.items.filter(
                (item: any) =>
                  !isExcludedShopCode(item?.fromShopCode || item?.FromShopCode) &&
                  !isExcludedShopCode(item?.toShopCode || item?.ToShopCode)
              )
            : [];
          if (Array.isArray(group?.items) && items.length === 0) return [];
          return Array.isArray(group?.items)
            ? [{
                ...group,
                items,
                suggestionCount: items.length,
                totalSuggestedQty: items.reduce(
                  (total: number, item: any) => total + (Number(item?.suggestedQty) || 0),
                  0
                ),
                sameProvinceCount: items.filter((item: any) => item?.isSameProvince).length,
              }]
            : [group];
        });
      }
      if (Array.isArray(filtered.expiringStockList)) {
        filtered.totalExpiringCount = filtered.expiringStockList.length;
      }
      if (Array.isArray(filtered.suggestions)) {
        filtered.suggestionCount = filtered.suggestions.length;
        filtered.bucketCounts = this.getTransferBucketCounts(filtered.suggestions);
      }
      if (Array.isArray(filtered.groupedSuggestions)) {
        filtered.groupCount = filtered.groupedSuggestions.length;
      }
      if (filtered.nationalStoreStockMap && typeof filtered.nationalStoreStockMap === "object") {
        filtered.nationalStoreStockMap = Object.fromEntries(
          Object.entries(filtered.nationalStoreStockMap).map(([productCode, stores]: [string, any]) => [
            productCode,
            Array.isArray(stores)
              ? stores.filter((store: any) => !isExcludedShopCode(store?.StoreCode || store?.ShopCode))
              : stores,
          ])
        );
      }
      return filtered;
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

      await this.withRequestTimeout((signal) => fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      }));
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
      const data = await this.withRequestTimeout(async (signal) => {
        const response = await fetch(url, { signal });
        if (!response.ok) return null;
        return response.json();
      });
      return data || null;
    } catch (error) {
      console.warn("[Firebase Cache] Lỗi khi tải product_catalog từ Firebase:", error);
      return null;
    }
  }

  private filterCacheEntry(entry: any): CacheEntry {
    if (!entry || !Array.isArray(entry.shops)) return entry;
    return {
      ...entry,
      shops: entry.shops.filter(
        (shop: any) => !isExcludedShopCode(shop?.StoreCode || shop?.ShopCode)
      ),
    };
  }

  private getTransferBucketCounts(suggestions: any[]): Record<string, number | string> {
    const allKeys = new Set<string>();
    const dangerKeys = new Set<string>();
    const warningKeys = new Set<string>();
    const safeKeys = new Set<string>();
    let allQty = 0;
    let dangerQty = 0;
    let warningQty = 0;
    let safeQty = 0;

    for (const item of suggestions) {
      const key = `${item.fromShopCode}|${item.productCode}`;
      const daysRemaining = Number(item.daysRemaining);
      const quantity = Number(item.suggestedQty) || 0;
      allKeys.add(key);
      allQty += quantity;

      if (daysRemaining >= 0 && daysRemaining <= 90) {
        dangerKeys.add(key);
        dangerQty += quantity;
      }
      if (daysRemaining > 90 && daysRemaining <= 180) {
        warningKeys.add(key);
        warningQty += quantity;
      }
      if (daysRemaining >= 0 && daysRemaining <= 365) {
        safeKeys.add(key);
        safeQty += quantity;
      }
    }

    const total = allKeys.size || 1;
    return {
      all: allKeys.size,
      allQty,
      allRate: "100,00",
      danger: dangerKeys.size,
      dangerQty,
      dangerRate: ((dangerKeys.size / total) * 100).toFixed(2).replace(".", ","),
      warning: warningKeys.size,
      warningQty,
      warningRate: ((warningKeys.size / total) * 100).toFixed(2).replace(".", ","),
      safe: safeKeys.size,
      safeQty,
      safeRate: ((safeKeys.size / total) * 100).toFixed(2).replace(".", ","),
    };
  }
}
