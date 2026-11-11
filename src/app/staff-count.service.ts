import { Injectable } from "@angular/core";
import { environment } from "../environments/environment";

/**
 * Realtime Database access for the staff inventory-count feature.
 *
 * Data layout (see database.rules.json):
 * - `shop_catalog/{shopCode}`: slim per-shop catalog written by the sync
 *   script, items are `{ c: code, n: name, u: unit }` for products whose total
 *   stock at that shop is > 0. Never contains quantities or prices.
 * - `shop_catalog_index`: `{ [shopCode]: { name, count, updatedAt } }`, used to
 *   label the shops a staff member may count.
 * - `product_catalog`: the existing system-wide slim catalog (public read),
 *   used so staff can also count a product they find on the shelf even when
 *   the system shows it out of stock at their shop.
 * - `count_submissions/{shopCode}/{sessionId}`: one submitted count sheet per
 *   staff member. Staff can only write their own sheet and can never read
 *   anyone's counts (blind cross-counting); only the admin role can read.
 * - `count_final_reviews/{shopCode}/{reviewId}`: the manager's confirmed final
 *   quantity per product after reviewing the staff counts. Admin only.
 */

export interface ShopCatalogItem {
  c: string;
  n: string;
  u: string;
}

export interface ShopCatalog {
  shopName: string;
  updatedAt: number;
  items: ShopCatalogItem[];
}

export interface ShopCatalogIndexEntry {
  name: string;
  count: number;
  updatedAt: number;
}

export interface CountSubmissionItem {
  code: string;
  name: string;
  unit: string;
  countedQuantity: number;
  outsideCatalog?: boolean;
}

export interface CountSubmission {
  id: string;
  staffUid: string;
  staffName: string;
  shopCode: string;
  shopName: string;
  createdAt: number;
  completedAt: number;
  items: CountSubmissionItem[];
}

export interface FinalReview {
  id: string;
  shopCode: string;
  reviewedBy: string;
  reviewedAt: number;
  items: { code: string; finalQuantity: number | null }[];
}

@Injectable({ providedIn: "root" })
export class StaffCountService {
  private get dbUrl(): string {
    return environment.firebaseDbUrl.replace(/\/+$/, "");
  }

  async getShopCatalogIndex(idToken: string): Promise<Record<string, ShopCatalogIndexEntry>> {
    const data = await this.readJson<Record<string, ShopCatalogIndexEntry> | null>(
      `shop_catalog_index.json?auth=${encodeURIComponent(idToken)}`,
    );
    return data || {};
  }

  async getShopCatalog(shopCode: string, idToken: string): Promise<ShopCatalog | null> {
    const data = await this.readJson<{
      shopName?: string;
      updatedAt?: number;
      items?: ShopCatalogItem[];
    } | null>(`shop_catalog/${encodeURIComponent(shopCode)}.json?auth=${encodeURIComponent(idToken)}`);
    if (!data) return null;
    return {
      shopName: String(data.shopName || shopCode),
      updatedAt: Number(data.updatedAt || 0),
      items: Array.isArray(data.items) ? data.items : [],
    };
  }

  /** System-wide slim catalog (public read), same shape as shop catalog items. */
  async getGlobalCatalog(): Promise<ShopCatalogItem[]> {
    const data = await this.readJson<{ items?: ShopCatalogItem[] } | null>("product_catalog.json");
    return Array.isArray(data?.items) ? data.items : [];
  }

  async submitCount(submission: CountSubmission, idToken: string): Promise<void> {
    await this.writeJson(
      `count_submissions/${encodeURIComponent(submission.shopCode)}/${encodeURIComponent(submission.id)}.json?auth=${encodeURIComponent(idToken)}`,
      submission,
    );
  }

  async listSubmissions(shopCode: string, idToken: string): Promise<CountSubmission[]> {
    const data = await this.readJson<Record<string, CountSubmission> | null>(
      `count_submissions/${encodeURIComponent(shopCode)}.json?auth=${encodeURIComponent(idToken)}`,
    );
    if (!data) return [];
    return Object.values(data)
      .filter((submission) => submission && Array.isArray(submission.items))
      .sort((first, second) => (second.completedAt || 0) - (first.completedAt || 0));
  }

  async saveFinalReview(review: FinalReview, idToken: string): Promise<void> {
    await this.writeJson(
      `count_final_reviews/${encodeURIComponent(review.shopCode)}/${encodeURIComponent(review.id)}.json?auth=${encodeURIComponent(idToken)}`,
      review,
    );
  }

  private async readJson<T>(path: string): Promise<T> {
    const response = await fetch(`${this.dbUrl}/${path}`);
    if (!response.ok) {
      throw new Error(`Không đọc được dữ liệu kiểm kê (mã ${response.status}).`);
    }
    return (await response.json()) as T;
  }

  private async writeJson(path: string, payload: unknown): Promise<void> {
    const response = await fetch(`${this.dbUrl}/${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`Không gửi được dữ liệu kiểm kê (mã ${response.status}).`);
    }
  }
}
