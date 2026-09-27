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
          if (firebaseData && firebaseData[code] && Array.isArray(firebaseData[code].shops) && firebaseData[code].shops.length > 0) {
            results[code] = firebaseData[code].shops;
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

    // Nếu tất cả sản phẩm đã có trong Firebase Cache, hoàn thành ngay lập tức!
    if (remainingProductIDs.length === 0) {
      return results;
    }

    // BƯỚC 2: Với các sản phẩm chưa có trong Cache, tổng hợp trực tiếp từ Firebase RTDB sales_speed của các shop
    // TUỆT ĐỐI KHÔNG gọi trực tiếp API UPharma /Report/GetExistProductLst để tránh giật lag/nghẽn mạng.
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

          if (storesWithStock.length > 0) {
            this.firebaseCache.saveCache(code, storesWithStock).catch(() => {});
          }
        }

        return results;
      }
    } catch (fbErr) {
      console.warn("[National Inventory Service] Lỗi khi tổng hợp từ Firebase sales_speed, mới gọi API UPharma làm dự phòng cuối:", fbErr);
    }

    // BƯỚC 3: Dự phòng cuối cùng (chỉ chạy khi Firebase hoàn toàn không khả dụng)
    console.warn(`[National Inventory Service] Dự phòng khẩn cấp: Gọi API UPharma cho ${remainingProductIDs.length} sản phẩm...`);
    const session = this.upharma.ensureLogin();
    const mode = options.mode || "GetExistProductLst";
    const endpoint = mode === "GetExistProductByShop" ? "/Report/GetExistProductByShop" : "/Report/GetExistProductLst";
    const batchSize = 10;

    for (let i = 0; i < remainingProductIDs.length; i += batchSize) {
      const batch = remainingProductIDs.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (code) => {
          if (results[code]) return;

          try {
            const response = await this.upharma.callEndpoint<any>(
              endpoint,
              {
                ProductID: code,
                uPharmaID: session.UserInfo.uPharmaID,
                Token: session.Token,
              },
              { cache: false }
            );

            let storesWithStock: NationalStoreStock[] = [];
            const rawList = response?.ExistProductLst || response?.data || response?.Data || response?.ShopLst || [];
            if (Array.isArray(rawList)) {
              storesWithStock = rawList
                .filter((store: any) => {
                  const qty = parseNumericValue(store.Quantity);
                  const avg = parseNumericValue(store.QuantityAVG ?? store.QuantityAvg);
                  return !isWarehouseStore(store) && (qty > 0 || avg > 0);
                })
                .map((store: any) => ({
                  StoreCode: store.StoreCode || store.ShopCode || "",
                  StoreName: store.StoreName || store.ShopName || "",
                  StoreType: store.StoreType || "",
                  Quantity: parseNumericValue(store.Quantity),
                  QuantityAVG: parseNumericValue(store.QuantityAVG ?? store.QuantityAvg ?? store.Quantity_AVG ?? 0),
                  UnitOfMeasure: store.UnitOfMeasure || store.Unit || "",
                }))
                .sort((a: NationalStoreStock, b: NationalStoreStock) => b.QuantityAVG - a.QuantityAVG);
            }

            results[code] = storesWithStock;

            this.firebaseCache.saveCache(code, storesWithStock).catch(() => {});
          } catch (error) {
            console.error(`[National Inventory API] Lỗi lấy tồn kho khẩn cấp cho mã ${code}:`, error);
            results[code] = [];
          } finally {
            done++;
            notifyProgress(code);
          }
        })
      );
    }

    return results;
  }
}



