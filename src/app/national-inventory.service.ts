import { Injectable } from "@angular/core";
import { parseNumericValue } from "./inventory-utils";
import { FirebaseInventoryService } from "./firebase-inventory.service";
import { UpharmaService } from "./upharma.service";

export interface NationalInventoryProgress {
  done: number;
  total: number;
  fromCache: number;
  fromApi: number;
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

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 giờ

@Injectable({
  providedIn: "root",
})
export class NationalInventoryService {
  constructor(
    private readonly upharma: UpharmaService,
    private readonly firebaseCache: FirebaseInventoryService,
  ) {}

  /**
   * Giải quyết thông tin tồn kho toàn quốc của danh sách sản phẩm.
   * Sử dụng Firebase cache trước, chỉ gọi API cho những sản phẩm chưa có trong cache hoặc đã quá hạn 12h.
   */
  async resolve(
    productIDs: string[],
    options: { forceRefresh?: boolean; onProgress?: (p: NationalInventoryProgress) => void } = {}
  ): Promise<Record<string, NationalStoreStock[]>> {
    const total = productIDs.length;
    let done = 0;
    let fromCache = 0;
    let fromApi = 0;

    const results: Record<string, NationalStoreStock[]> = {};
    const notifyProgress = (currentProduct: string) => {
      if (options.onProgress) {
        options.onProgress({
          done,
          total,
          fromCache,
          fromApi,
          currentProduct,
        });
      }
    };

    // 1. Tải toàn bộ cache từ Firebase nếu không bắt buộc làm mới
    let cacheData: Record<string, any> = {};
    if (!options.forceRefresh) {
      cacheData = await this.firebaseCache.getAllCache();
    }

    const missedProducts: string[] = [];
    const now = Date.now();

    // 2. Phân loại hit/miss cache
    for (const code of productIDs) {
      const cached = cacheData[code];
      const isFresh = cached && cached.updatedAt && (now - cached.updatedAt) < CACHE_TTL_MS;

      if (isFresh) {
        const shops = Array.isArray(cached.shops) ? cached.shops : [];
        // Lọc top 3 QuantityAVG từ cache cũ hoặc mới
        results[code] = shops
          .map((s: any) => ({
            StoreCode: s.StoreCode,
            StoreName: s.StoreName,
            StoreType: s.StoreType || "",
            Quantity: parseNumericValue(s.Quantity),
            QuantityAVG: parseNumericValue(s.QuantityAVG ?? s.QuantityAvg ?? s.Quantity_AVG ?? 0),
            UnitOfMeasure: s.UnitOfMeasure || "",
          }))
          .sort((a: NationalStoreStock, b: NationalStoreStock) => b.QuantityAVG - a.QuantityAVG)
          .slice(0, 3);
        done++;
        fromCache++;
        notifyProgress(code);
      } else {
        missedProducts.push(code);
      }
    }

    if (missedProducts.length === 0) {
      return results;
    }

    // 3. Gọi API song song có giới hạn (10 request/lần) cho những sản phẩm bị miss cache
    const session = this.upharma.ensureLogin();
    const batchSize = 10;

    for (let i = 0; i < missedProducts.length; i += batchSize) {
      const batch = missedProducts.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (code) => {
          try {
            const response = await this.upharma.callEndpoint<any>(
              "/Report/GetExistProductLst",
              {
                ProductID: code,
                uPharmaID: session.UserInfo.uPharmaID,
                Token: session.Token,
              },
              { cache: false }
            );

            let storesWithStock: NationalStoreStock[] = [];
            if (response && Array.isArray(response.ExistProductLst)) {
              storesWithStock = response.ExistProductLst
                .filter((store: any) => parseNumericValue(store.Quantity) > 0)
                .map((store: any) => ({
                  StoreCode: store.StoreCode,
                  StoreName: store.StoreName,
                  StoreType: store.StoreType || "",
                  Quantity: parseNumericValue(store.Quantity),
                  QuantityAVG: parseNumericValue(store.QuantityAVG ?? store.QuantityAvg ?? store.Quantity_AVG ?? 0),
                  UnitOfMeasure: store.UnitOfMeasure || "",
                }))
                .sort((a: NationalStoreStock, b: NationalStoreStock) => b.QuantityAVG - a.QuantityAVG)
                .slice(0, 3); // Lấy tối đa 3 shop có tiêu thụ lớn nhất
            }

            results[code] = storesWithStock;

            // Lưu kết quả mới vào Firebase cache
            await this.firebaseCache.saveCache(code, storesWithStock);
          } catch (error) {
            console.error(`[National Inventory] Lỗi lấy tồn kho cho mã ${code}:`, error);
            results[code] = []; // fallback rỗng
          } finally {
            done++;
            fromApi++;
            notifyProgress(code);
          }
        })
      );
    }

    return results;
  }
}
