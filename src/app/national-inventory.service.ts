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
      onItemResolved?: (productCode: string, stores: NationalStoreStock[]) => void;
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

    // BƯỚC 1: Thử lấy dữ liệu từ Firebase bằng On-Demand Batch Fetch (~2KB/mã, cực nhanh)
    if (!options.forceRefresh) {
      try {
        console.log(`[National Inventory Service] Đang truy vấn Firebase cache On-Demand cho ${total} sản phẩm...`);
        const firebaseData = await this.firebaseCache.getBatchCache(productIDs);
        
        for (const code of productIDs) {
          const trimmed = code.trim();
          const sanitized = trimmed.replace(/[.$#\[\]\/]/g, "_");
          
          let entry = firebaseData ? (
            firebaseData[trimmed] || 
            firebaseData[sanitized] || 
            firebaseData[trimmed.toUpperCase()] || 
            firebaseData[sanitized.toUpperCase()]
          ) : undefined;

          if (!entry && firebaseData) {
            const keys = Object.keys(firebaseData);
            const matchedKey = keys.find(k => k.toUpperCase() === sanitized.toUpperCase() || k.toUpperCase() === trimmed.toUpperCase());
            if (matchedKey) {
              entry = firebaseData[matchedKey];
            }
          }

          // Nếu sản phẩm đã được CronJob tính toán và lưu trong Firebase cache
          if (entry && Array.isArray(entry.shops)) {
            results[code] = entry.shops;
            done++;
            notifyProgress(`${code} (Firebase Cache On-Demand)`);
            if (options.onItemResolved) {
              options.onItemResolved(code, entry.shops);
            }
          } else {
            remainingProductIDs.push(code);
          }
        }

        console.log(`[National Inventory Service] Đã lấy thành công ${done}/${total} sản phẩm từ Firebase Cache On-Demand!`);
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

    // BƯỚC 2: Firebase cache NULL / thiếu sản phẩm → Đọc sales_speed từ Firebase cho tất cả nhà thuốc (KHÔNG gọi API UPharma)
    console.log(
      `[National Inventory Service] Firebase cache thiếu ${remainingProductIDs.length} sản phẩm → Đọc sales_speed từ Firebase RTDB cho toàn bộ nhà thuốc...`
    );

    try {
      const salesSpeedRes = await this.upharma.callEndpoint<any>(
        "/SalesInvoice/GetReportSalesSpeed",
        {},
        { cache: true, forceRefresh: options.forceRefresh }
      );

      const allRows: any[] = Array.isArray(salesSpeedRes)
        ? salesSpeedRes
        : Array.isArray(salesSpeedRes?.data)
        ? salesSpeedRes.data
        : [];

      // Gom nhóm theo ProductID
      const productMap = new Map<string, NationalStoreStock[]>();

      for (const row of allRows) {
        const pCode = String(row.ProductID || row.ProductCode || "").trim();
        if (!pCode) continue;

        if (isWarehouseStore(row)) continue;

        const storeCode = String(row.StoreCode || row.ShopCode || row.__shopCode || "").trim();
        const storeName = String(row.StoreName || row.ShopName || row.__shopName || storeCode).trim();
        const qty = parseNumericValue(row.QuantityExist ?? row.Quantity ?? 0);
        const qtyAVG = parseNumericValue(
          row.QuantityAVG ?? row.AVGQuantity ?? row.QuantityAVG30 ?? row.Quantity ?? 0
        );
        const unit = String(row.UnitOfMeasure || row.Unit || "Hộp");

        if (!storeCode || (qty <= 0 && qtyAVG <= 0)) continue;

        const stock: NationalStoreStock = {
          StoreCode: storeCode,
          StoreName: storeName,
          StoreType: String(row.StoreType || ""),
          Quantity: qty,
          QuantityAVG: qtyAVG,
          UnitOfMeasure: unit,
        };

        const key = pCode.toUpperCase();
        if (!productMap.has(key)) {
          productMap.set(key, []);
        }
        productMap.get(key)!.push(stock);
      }

      for (const code of remainingProductIDs) {
        const key = code.trim().toUpperCase();
        const stores = productMap.get(key) || [];
        stores.sort((a, b) => b.QuantityAVG - a.QuantityAVG);

        results[code] = stores;
        done++;
        notifyProgress(`${code} (Firebase RTDB - ${stores.length} nhà thuốc)`);
        if (options.onItemResolved) {
          options.onItemResolved(code, stores);
        }
      }
    } catch (err) {
      console.warn("[National Inventory Service] Lỗi khi lấy sales_speed từ Firebase RTDB:", err);
      for (const code of remainingProductIDs) {
        if (!results[code]) {
          results[code] = [];
          done++;
          notifyProgress(`${code} (lỗi Firebase)`);
          if (options.onItemResolved) {
            options.onItemResolved(code, []);
          }
        }
      }
    }

    return results;
  }
}
