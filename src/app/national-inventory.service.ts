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
   * MẶC ĐỊNH: Tải siêu tốc từ Firebase Realtime Database cache trước.
   * Nếu có sản phẩm chưa có trong Firebase (hoặc forceRefresh=true), mới gọi trực tiếp API UPharma
   * và tự động đồng bộ kết quả mới lên Firebase Cache.
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

    // BƯỚC 1: Thử lấy dữ liệu từ Firebase Realtime Database Cache (Siêu nhanh 1 HTTP request)
    if (!options.forceRefresh) {
      try {
        console.log(`[National Inventory Service] Đang truy vấn Firebase cache cho ${total} sản phẩm...`);
        const firebaseData = await this.firebaseCache.getAllCache();
        
        for (const code of productIDs) {
          if (firebaseData && firebaseData[code] && Array.isArray(firebaseData[code].shops)) {
            results[code] = firebaseData[code].shops;
            done++;
            notifyProgress(`${code} (Firebase)`);
          } else {
            remainingProductIDs.push(code);
          }
        }

        console.log(`[National Inventory Service] Đã lấy thành công ${done}/${total} sản phẩm từ Firebase Cache!`);
      } catch (err) {
        console.warn("[National Inventory Service] Lỗi khi truy vấn Firebase Cache, chuyển sang gọi API trực tiếp:", err);
        remainingProductIDs.push(...productIDs);
      }
    } else {
      remainingProductIDs.push(...productIDs);
    }

    // Nếu tất cả sản phẩm đã có trong Firebase Cache, hoàn thành lập tức!
    if (remainingProductIDs.length === 0) {
      return results;
    }

    // BƯỚC 2: Với các sản phẩm chưa có trong Cache (hoặc forceRefresh), gọi API UPharma trực tiếp
    console.log(`[National Inventory Service] Đang gọi API UPharma cho ${remainingProductIDs.length} sản phẩm còn thiếu...`);
    const session = this.upharma.ensureLogin();
    const mode = options.mode || "GetExistProductLst";
    const endpoint = mode === "GetExistProductByShop" ? "/Report/GetExistProductByShop" : "/Report/GetExistProductLst";
    const batchSize = 10;

    for (let i = 0; i < remainingProductIDs.length; i += batchSize) {
      const batch = remainingProductIDs.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (code) => {
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

            // Tự động đồng bộ lên Firebase Cache cho các lần gọi sau
            this.firebaseCache.saveCache(code, storesWithStock).catch((e) => {
              console.warn(`[Firebase Cache] Không thể tự động lưu cache cho ${code}:`, e);
            });
          } catch (error) {
            console.error(`[National Inventory API] Lỗi lấy tồn kho trực tiếp cho mã ${code}:`, error);
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


