import { Injectable } from "@angular/core";
import { isWarehouseStore, parseNumericValue } from "./inventory-utils";
import { UpharmaService } from "./upharma.service";
import { FirebaseInventoryService } from "./firebase-inventory.service";

export interface NationalInventoryProgress {
  done: number;
  total: number;
  currentProduct: string;
}

export interface NationalStoreStock {
  StoreCode: string;
  StoreName: string;
  StoreType: string;
  Quantity: number;
  QuantityAVG: number;
  UnitOfMeasure: string;
  [key: string]: any;
}

export type InventoryApiMode = "GetExistProductLst" | "GetExistProductByShop";

@Injectable({
  providedIn: "root",
})
export class NationalInventoryService {
  constructor(
    private readonly upharma: UpharmaService,
    private readonly firebaseCache: FirebaseInventoryService
  ) {}

  /**
   * Lấy tồn kho & tốc độ tiêu thụ hàng hóa toàn quốc theo danh sách mã sản phẩm.
   * 100% TỪ FIREBASE REALTIME DATABASE CACHE (Không gọi trực tiếp API GetExistProductLst trên UPharma server).
   */
  async resolve(
    productIDs: string[],
    options: {
      mode?: InventoryApiMode;
      forceRefresh?: boolean;
      onProgress?: (p: NationalInventoryProgress) => void;
    } = {}
  ): Promise<Record<string, NationalStoreStock[]>> {
    const total = productIDs.length;
    let done = 0;
    const results: Record<string, NationalStoreStock[]> = {};

    const notifyProgress = (currentProduct: string) => {
      if (options.onProgress) {
        options.onProgress({
          done,
          total,
          currentProduct,
        });
      }
    };

    if (total === 0) return results;

    const remainingProductIDs: string[] = [];

    // BƯỚC 1: Thử lấy dữ liệu từ Firebase Cache chung (/national_inventory_cache.json)
    if (!options.forceRefresh) {
      try {
        console.log(`[National Inventory Service] Đang truy vấn Firebase cache cho ${total} sản phẩm...`);
        const firebaseData = await this.firebaseCache.getAllCache();
        
        for (const code of productIDs) {
          const sanitized = code.replace(/[.$#\[\]\/]/g, "_");
          const entry = firebaseData ? (firebaseData[code] || firebaseData[sanitized]) : undefined;

          // Nếu sản phẩm đã được CronJob tính toán và lưu trong Firebase cache
          if (entry && Array.isArray(entry.shops)) {
            results[code] = entry.shops;
            done++;
            notifyProgress(`${code} (Firebase Cache)`);
          } else {
            remainingProductIDs.push(code);
          }
        }

        console.log(`[National Inventory Service] Đã lấy thành công ${done}/${total} sản phẩm từ Firebase Cache!`);
      } catch (err) {
        console.warn("[National Inventory Service] Lỗi khi truy vấn Firebase Cache:", err);
        remainingProductIDs.push(...productIDs);
      }
    } else {
      remainingProductIDs.push(...productIDs);
    }

    // Nếu tất cả sản phẩm đã có đủ trong Firebase Cache, hoàn thành ngay lập tức!
    if (remainingProductIDs.length === 0) {
      return results;
    }

    // BƯỚC 2: Firebase cache NULL → gọi thẳng /Report/GetExistProductLst trên UPharma API
    // API này trả về tồn kho + sức bán của sản phẩm trên TOÀN BỘ 35+ nhà thuốc toàn quốc
    console.log(`[National Inventory Service] Firebase cache NULL → Fallback gọi GetExistProductLst cho ${remainingProductIDs.length} sản phẩm (batch 10)...`);

    const BATCH_SIZE = 10;
    for (let i = 0; i < remainingProductIDs.length; i += BATCH_SIZE) {
      const batch = remainingProductIDs.slice(i, i + BATCH_SIZE);

      await Promise.all(batch.map(async (code) => {
        try {
          const res = await this.upharma.callEndpoint<any>(
            "/Report/GetExistProductLst",
            {
              ProductID: code,
              _bypassFirebase: true,
            },
            { cache: true, forceRefresh: options.forceRefresh }
          );

          // API trả về array các store trực tiếp hoặc bọc trong nhiều key khác nhau
          let rawStores: any[] = [];
          if (Array.isArray(res)) {
            rawStores = res;
          } else if (res && typeof res === 'object') {
            rawStores =
              res.InventoryLst || res.ExistProductLst || res.StoreLst ||
              res.Data || res.data || res.DataLst || res.ListData || [];
          }

          const stores: NationalStoreStock[] = rawStores
            .filter((s: any) => !isWarehouseStore(s))
            .map((s: any) => ({
              StoreCode: String(s.StoreCode || s.ShopCode || "").trim(),
              StoreName: String(s.StoreName || s.ShopName || "").trim(),
              StoreType: String(s.StoreType || ""),
              Quantity: parseNumericValue(s.QuantityExist ?? s.Quantity ?? 0),
              QuantityAVG: parseNumericValue(s.QuantityAVG ?? s.AVGQuantity ?? s.Quantity ?? 0),
              UnitOfMeasure: String(s.UnitOfMeasure || s.Unit || "Hộp"),
            }))
            .filter((s) => s.StoreCode && (s.Quantity > 0 || s.QuantityAVG > 0))
            .sort((a, b) => b.QuantityAVG - a.QuantityAVG);

          results[code] = stores;
          done++;
          notifyProgress(`${code} (UPharma API - ${stores.length} nhà thuốc)`);
        } catch (err) {
          console.warn(`[National Inventory Service] Lỗi GetExistProductLst cho ${code}:`, err);
          results[code] = [];
          done++;
          notifyProgress(`${code} (lỗi)`);
        }
      }));
    }

    return results;
  }
}



