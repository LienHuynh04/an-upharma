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

    // BƯỚC 2: Gom dữ liệu trực tiếp từ Firebase sales_speed của các shop (Hoàn toàn KHÔNG gọi API GetExistProductLst tới icpc1hn.work)
    try {
      console.log(`[National Inventory Service] Đang tổng hợp dữ liệu từ Firebase RTDB (sales_speed) cho ${remainingProductIDs.length} sản phẩm...`);
      
      const salesSpeedRes = await this.upharma.callEndpoint<any>(
        "/Report/GetReportSalesSpeed",
        {},
        { cache: true, forceRefresh: options.forceRefresh }
      );
      
      const rawRows: any[] = salesSpeedRes?.data || salesSpeedRes?.Data || (Array.isArray(salesSpeedRes) ? salesSpeedRes : []);

      if (Array.isArray(rawRows) && rawRows.length > 0) {
        const prodShopMap = new Map<string, Map<string, NationalStoreStock>>();

        for (const row of rawRows) {
          const code = String(row.ProductID || row.ProductCode || "").trim();
          const shopCode = String(row.__shopCode || row.ShopCode || "").trim();
          if (!code || !shopCode || isWarehouseStore(row)) continue;

          if (!prodShopMap.has(code)) {
            prodShopMap.set(code, new Map<string, NationalStoreStock>());
          }
          const shopMap = prodShopMap.get(code)!;

          const qty = parseNumericValue(row.QuantityExist ?? row.Quantity);
          const avg = parseNumericValue(row.Quantity);

          if (shopMap.has(shopCode)) {
            const existing = shopMap.get(shopCode)!;
            existing.QuantityAVG = Math.max(existing.QuantityAVG, avg);
            if (row.QuantityExist !== undefined) {
              existing.Quantity = qty;
            }
          } else {
            shopMap.set(shopCode, {
              StoreCode: shopCode,
              StoreName: row.__shopName || row.ShopName || shopCode,
              StoreType: row.StoreType || "",
              Quantity: qty,
              QuantityAVG: avg,
              UnitOfMeasure: row.UnitOfMeasure || row.Unit || "Hộp",
            });
          }
        }

        for (const code of remainingProductIDs) {
          const shopMap = prodShopMap.get(code);
          const storesWithStock: NationalStoreStock[] = shopMap
            ? Array.from(shopMap.values())
                .filter((s) => s.Quantity > 0 || s.QuantityAVG > 0)
                .sort((a, b) => b.QuantityAVG - a.QuantityAVG)
            : [];

          results[code] = storesWithStock;
          done++;
          notifyProgress(`${code} (Firebase RTDB)`);
        }

        return results;
      }
    } catch (fbErr) {
      console.warn("[National Inventory Service] Lỗi khi tổng hợp từ Firebase sales_speed:", fbErr);
    }

    return results;
  }
}



