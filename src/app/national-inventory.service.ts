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
  /**
   * Tuổi tối đa của cache tồn kho toàn quốc trên Firebase. Sync chạy mỗi giờ —
   * quá 6h nghĩa là sync đã hỏng nhiều phiên. FIX (2026-10-15): trước đây không
   * kiểm tra TTL, quyết định tồn kho trên số liệu nhiều ngày tuổi.
   */
  private readonly NATIONAL_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

  constructor(
    private readonly upharma: UpharmaService,
    private readonly firebaseCache: FirebaseInventoryService
  ) {}

  /**
   * Lấy tồn kho & tốc độ tiêu thụ hàng hóa toàn quốc theo danh sách mã sản phẩm.
   * Ưu tiên số 1: Lấy từ Firebase Realtime Database Cache (/national_inventory_cache).
   * Ưu tiên số 2: On-demand gọi API /Report/GetExistProductLst để lấy tồn kho toàn quốc chính xác 100%.
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

    // BƯỚC 1: Thử lấy dữ liệu từ Firebase cache
    if (!options.forceRefresh) {
      try {
        console.log(`[National Inventory Service] Đang truy vấn Firebase cache cho ${total} sản phẩm...`);
        const firebaseData = await this.firebaseCache.getBatchCache(productIDs);
        
        const upperMap = new Map<string, any>();
        if (firebaseData) {
          for (const k of Object.keys(firebaseData)) {
            upperMap.set(k.toUpperCase(), firebaseData[k]);
          }
        }
        
        for (const code of productIDs) {
          const trimmed = code.trim();
          const sanitized = trimmed.replace(/[.$#\[\]\/]/g, "_");
          const upperTrimmed = trimmed.toUpperCase();
          const upperSanitized = sanitized.toUpperCase();
          
          let entry = firebaseData ? (
            firebaseData[trimmed] || 
            firebaseData[sanitized] || 
            upperMap.get(upperTrimmed) || 
            upperMap.get(upperSanitized)
          ) : undefined;

          // Nếu sản phẩm đã có trong Firebase cache (còn hạn) và có danh sách stores
          const entryUpdatedAt = Number(entry?.updatedAt) || 0;
          const isEntryStale =
            entryUpdatedAt > 0 && Date.now() - entryUpdatedAt > this.NATIONAL_CACHE_MAX_AGE_MS;
          if (isEntryStale) {
            console.warn(
              `[National Inventory] Bỏ qua cache đã cũ ${Math.round((Date.now() - entryUpdatedAt) / 3600000)}h của ${code} — tải mới từ API.`
            );
          }
          if (entry && !isEntryStale && Array.isArray(entry.shops)) {
            const validShops = entry.shops.map((s: any) => ({
              StoreCode: String(s.StoreCode || "").trim(),
              StoreName: String(s.StoreName || "").trim(),
              StoreType: String(s.StoreType || ""),
              Quantity: parseNumericValue(s.QuantityExist ?? s.Quantity ?? 0),
              QuantityAVG: parseNumericValue(s.QuantityAVG ?? s.AVGQuantity ?? s.Quantity ?? 0),
              UnitOfMeasure: String(s.UnitOfMeasure || s.Unit || "Hộp"),
            }));

            results[code] = validShops;
            done++;
            notifyProgress(`${code} (Firebase Cache Toàn Quốc)`);
            if (options.onItemResolved) {
              options.onItemResolved(code, validShops);
            }
          } else {
            remainingProductIDs.push(code);
          }
        }

        console.log(`[National Inventory Service] Đã lấy thành công ${done}/${total} sản phẩm từ Firebase Cache toàn quốc!`);
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

    // BƯỚC 2: Các mã chưa có trên Firebase Cache → Gọi trực tiếp API UPharma /Report/GetExistProductLst để lấy tồn kho toàn quốc
    console.log(
      `[National Inventory Service] Đang tra cứu tồn kho toàn quốc cho ${remainingProductIDs.length} sản phẩm trực tiếp từ API UPharma...`
    );

    let session: any = null;
    try {
      session = this.upharma.ensureLogin();
    } catch {
      session = null;
    }

    if (session && session.Token) {
      const CONCURRENCY = 6;
      const chunks: string[][] = [];
      for (let i = 0; i < remainingProductIDs.length; i += CONCURRENCY) {
        chunks.push(remainingProductIDs.slice(i, i + CONCURRENCY));
      }

      for (const chunk of chunks) {
        await Promise.all(
          chunk.map(async (code) => {
            try {
              const res: any = await this.upharma.callEndpoint(
                "/Report/GetExistProductLst",
                {
                  ProductID: code,
                  Token: session.Token,
                  uPharmaID: String(session.UserInfo?.uPharmaID ?? ""),
                  _bypassFirebase: true,
                },
                { cache: true }
              );

              const rawStores: any[] = Array.isArray(res)
                ? res
                : res?.Data || res?.data || res?.ItemLst || (Object.values(res || {}).find((v) => Array.isArray(v)) as any[]) || [];

              const validStores: NationalStoreStock[] = rawStores
                .filter((s: any) => {
                  const storeType = String(s.StoreType || "").toLowerCase();
                  const storeCode = String(s.StoreCode || "").toUpperCase();
                  return !storeType.includes("kho") && !storeCode.startsWith("KHO") && !storeCode.startsWith("DN") && storeCode !== "";
                })
                .map((s: any) => ({
                  StoreCode: String(s.StoreCode || "").trim(),
                  StoreName: String(s.StoreName || "").trim(),
                  StoreType: String(s.StoreType || ""),
                  Quantity: parseNumericValue(s.QuantityExist ?? s.Quantity ?? 0),
                  QuantityAVG: parseNumericValue(s.QuantityAVG ?? s.AVGQuantity ?? s.Quantity ?? 0),
                  UnitOfMeasure: String(s.UnitOfMeasure || s.Unit || "Hộp"),
                }))
                .filter((s) => s.Quantity > 0 || s.QuantityAVG > 0)
                .sort((a, b) => b.QuantityAVG - a.QuantityAVG);

              results[code] = validStores;
              done++;
              notifyProgress(`${code} (API Toàn Quốc - ${validStores.length} NT)`);

              if (options.onItemResolved) {
                options.onItemResolved(code, validStores);
              }

              // Lưu lên Firebase để lần sau và người khác dùng lại ngay
              void this.firebaseCache.saveCache(code, validStores);
            } catch (err) {
              console.warn(`[National Inventory Service] Lỗi khi tra cứu mã ${code}:`, err);
              results[code] = [];
              done++;
              notifyProgress(`${code} (Lỗi tra cứu)`);
              if (options.onItemResolved) {
                options.onItemResolved(code, []);
              }
            }
          })
        );
      }
    } else {
      // BƯỚC 3: Nếu không có session đăng nhập, fallback về sales_speed
      for (const code of remainingProductIDs) {
        results[code] = [];
        done++;
        notifyProgress(`${code} (Chưa đăng nhập)`);
        if (options.onItemResolved) {
          options.onItemResolved(code, []);
        }
      }
    }

    return results;
  }
}
