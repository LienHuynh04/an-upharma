import { Injectable } from "@angular/core";
import { environment } from "../../environments/environment";
import { UpharmaService } from "../upharma.service";
import { isExcludedShopCode } from "../excluded-shops.utils";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export interface ShopSummary {
  outOfStockCount: number;
  stableCount: number;
  slowCount: number;
  keyCount: number;
}

export interface TopExpiring {
  n: string; d: number; q: number; u: string; s: string;
}
export interface TopSuggestion {
  n: string; f: string; t: string; q: number; u: string; d: number;
}
export interface DataSnapshot {
  fetchedAt: string | null;
  dataAge: string;
  shopCount: number;
  shopCodes: string[];
  perShop: Record<string, ShopSummary>;
  totals: { outOfStock: number; stable: number; slow: number; key: number };
  // --- Deep data (như bản độc lập) ---
  catalogCount: number;
  expiringCount: number;
  suggestionCount: number;
  suggestionGroups: number;
  dangerQty: number;
  warningQty: number;
  deepAge: string;
  topExpiring: TopExpiring[];
  topSuggestions: TopSuggestion[];
}

export interface CatalogItem {
  c: string;
  n: string;
  u: string;
}

export interface NationalStock {
  productID: string;
  name: string;
  unit: string;
  totalQty: number;
  perShop: { shop: string; qty: number; avg: number }[];
}

/**
 * Trợ lý AI cho app UPHARMA.
 * - Câu hỏi về số liệu: trả lời trực tiếp từ Firebase (không tốn AI).
 * - Câu hỏi mở/gợi ý: gửi kèm snapshot cho Gemini.
 * API key do người dùng nhập 1 lần, lưu localStorage (không commit lên repo).
 */
@Injectable({ providedIn: "root" })
export class AiAssistantService {
  private readonly KEY_STORAGE = "ai_assistant_gemini_key";
  /** Models to try in order — fallback if the first returns 404. */
  private readonly MODELS = ["gemini-3.8-flash", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
  private snapshotCache: { at: number; data: DataSnapshot } | null = null;
  private readonly SNAPSHOT_TTL_MS = 5 * 60 * 1000;
  private catalogCache: { at: number; items: CatalogItem[]; count: number } | null = null;
  private readonly CATALOG_TTL_MS = 60 * 60 * 1000;
  private transferCache: { at: number; data: any } | null = null;
  private readonly TRANSFER_TTL_MS = 5 * 60 * 1000;

  constructor(private upharma: UpharmaService) {}

  // ---------- API key ----------
  /** Built-in key from environment (auto) → localStorage key (manual) → null. */
  getApiKey(): string | null {
    const builtIn = String((environment as any).geminiApiKey || "").trim();
    if (builtIn) return builtIn;
    try {
      return localStorage.getItem(this.KEY_STORAGE);
    } catch {
      return null;
    }
  }

  setApiKey(key: string): void {
    try {
      localStorage.setItem(this.KEY_STORAGE, key.trim());
    } catch {
      /* ignore */
    }
  }

  clearApiKey(): void {
    try {
      localStorage.removeItem(this.KEY_STORAGE);
    } catch {
      /* ignore */
    }
  }

  hasApiKey(): boolean {
    return !!this.getApiKey();
  }

  // ---------- Data snapshot ----------
  async getDataSnapshot(forceRefresh = false): Promise<DataSnapshot> {
    if (!forceRefresh && this.snapshotCache && Date.now() - this.snapshotCache.at < this.SNAPSHOT_TTL_MS) {
      return this.snapshotCache.data;
    }
    const empty: DataSnapshot = {
      fetchedAt: null,
      dataAge: "chưa rõ",
      shopCount: 0,
      shopCodes: [],
      perShop: {},
      totals: { outOfStock: 0, stable: 0, slow: 0, key: 0 },
      catalogCount: 0,
      expiringCount: 0,
      suggestionCount: 0,
      suggestionGroups: 0,
      dangerQty: 0,
      warningQty: 0,
      deepAge: "chưa rõ",
      topExpiring: [],
      topSuggestions: [],
    };
    try {
      const base = (environment as any).firebaseDbUrl?.replace(/\/$/, "");
      if (!base) return empty;
      const res = await fetch(`${base}/shops_summary.json`);
      if (!res.ok) return empty;
      const json = await res.json();
      const data = json?.data || {};
      const codes = Object.keys(data).filter((code) => !isExcludedShopCode(code));
      const totals = { outOfStock: 0, stable: 0, slow: 0, key: 0 };
      const perShop: Record<string, ShopSummary> = {};
      for (const code of codes) {
        const s = data[code] || {};
        const row: ShopSummary = {
          outOfStockCount: Number(s.outOfStockCount) || 0,
          stableCount: Number(s.stableCount) || 0,
          slowCount: Number(s.slowCount) || 0,
          keyCount: Number(s.keyCount) || 0,
        };
        perShop[code] = row;
        totals.outOfStock += row.outOfStockCount;
        totals.stable += row.stableCount;
        totals.slow += row.slowCount;
        totals.key += row.keyCount;
      }
      const snap: DataSnapshot = {
        fetchedAt: json?.fetchedAt || null,
        dataAge: json?.fetchedAt ? this.formatAge(json.fetchedAt) : "chưa rõ",
        shopCount: codes.length,
        shopCodes: codes,
        perShop,
        totals,
        catalogCount: 0,
        expiringCount: 0,
        suggestionCount: 0,
        suggestionGroups: 0,
        dangerQty: 0,
        warningQty: 0,
        deepAge: "chưa rõ",
        topExpiring: [],
        topSuggestions: [],
      };
      this.snapshotCache = { at: Date.now(), data: snap };
      return snap;
    } catch {
      return this.snapshotCache?.data || empty;
    }
  }

  // ---------- Deep data ----------
  /** Node SUMMARY nhẹ (~1KB) thay vì node ALL (~11MB). */
  async getTransferSummary(): Promise<any | null> {
    if (this.transferCache && Date.now() - this.transferCache.at < this.TRANSFER_TTL_MS) {
      return this.transferCache.data;
    }
    try {
      const base = (environment as any).firebaseDbUrl?.replace(/\/$/, "");
      if (!base) return null;
      const res = await fetch(`${base}/transfer_suggestions_cache/SUMMARY.json`);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data) return null;
      if (Array.isArray(data.topExpiring)) {
        data.topExpiring = data.topExpiring.filter((item: any) => !isExcludedShopCode(item?.s));
      }
      if (Array.isArray(data.topSuggestions)) {
        data.topSuggestions = data.topSuggestions.filter(
          (item: any) => !isExcludedShopCode(item?.f) && !isExcludedShopCode(item?.t)
        );
      }
      this.transferCache = { at: Date.now(), data };
      return data;
    } catch {
      return this.transferCache?.data || null;
    }
  }

  /** Danh mục sản phẩm (~790KB) — cache 60 phút. */
  async getCatalog(): Promise<{ items: CatalogItem[]; count: number }> {
    if (this.catalogCache && Date.now() - this.catalogCache.at < this.CATALOG_TTL_MS) {
      return this.catalogCache;
    }
    const fallback = this.catalogCache || { at: 0, items: [], count: 0 };
    try {
      const base = (environment as any).firebaseDbUrl?.replace(/\/$/, "");
      if (!base) return fallback;
      const res = await fetch(`${base}/product_catalog.json`);
      if (!res.ok) return fallback;
      const json = await res.json();
      const items: CatalogItem[] = json?.items || [];
      const data = { at: Date.now(), items, count: json?.count || items.length };
      this.catalogCache = data;
      return data;
    } catch {
      return fallback;
    }
  }

  /** Tìm sản phẩm theo tên hoặc mã (không dấu, không phân biệt hoa thường). */
  async lookupProduct(query: string): Promise<CatalogItem | null> {
    const { items } = await this.getCatalog();
    if (!items.length) return null;
    const norm = (s: string) =>
      (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const q = norm(query.trim());
    if (!q) return null;
    // Ưu tiên: mã chính xác → tên bắt đầu bằng → tên chứa
    return (
      items.find((i) => norm(i.c) === q) ||
      items.find((i) => norm(i.n).startsWith(q)) ||
      items.find((i) => norm(i.n).includes(q)) ||
      null
    );
  }

  /** Tồn kho toàn quốc của 1 sản phẩm theo mã. */
  async getNationalStock(productCode: string): Promise<NationalStock | null> {
    try {
      const base = (environment as any).firebaseDbUrl?.replace(/\/$/, "");
      if (!base) return null;
      const safeCode = productCode.replace(/[.#$[\]]/g, "_");
      const res = await fetch(`${base}/national_inventory_cache/${safeCode}.json`);
      if (!res.ok) return null;
      const json = await res.json();
      if (!json || !json.shops) return null;
      const perShop = (json.shops || [])
        .filter((s: any) => !isExcludedShopCode(s?.StoreCode || s?.ShopCode))
        .map((s: any) => ({
        shop: s.StoreCode,
        qty: Number(s.Quantity) || 0,
        avg: Number(s.QuantityAVG) || 0,
        }));
      const catalog = await this.lookupProduct(productCode);
      return {
        productID: productCode,
        name: catalog?.n || productCode,
        unit: catalog?.u || "",
        totalQty: perShop.reduce((sum: number, s: { qty: number }) => sum + s.qty, 0),
        perShop: perShop.sort((a: { qty: number }, b: { qty: number }) => b.qty - a.qty),
      };
    } catch {
      return null;
    }
  }

  /**
   * Snapshot nhẹ cho mọi câu hỏi: shops_summary + SUMMARY (~6KB).
   * KHÔNG tải product_catalog (791KB) ở đây — chỉ tải khi user hỏi về tên sản phẩm cụ thể.
   */
  async getDeepSnapshot(): Promise<DataSnapshot> {
    const [snap, transfer] = await Promise.all([this.getDataSnapshot(), this.getTransferSummary()]);
    if (transfer) {
      snap.expiringCount = Number(transfer.totalExpiringCount) || 0;
      snap.suggestionCount = Number(transfer.suggestionCount) || 0;
      snap.suggestionGroups = Number(transfer.groupCount) || 0;
      snap.dangerQty = Number(transfer.bucketCounts?.dangerQty) || 0;
      snap.warningQty = Number(transfer.bucketCounts?.warningQty) || 0;
      snap.deepAge = transfer.fetchedAt ? this.formatAge(transfer.fetchedAt) : snap.dataAge;
      snap.topExpiring = Array.isArray(transfer.topExpiring) ? transfer.topExpiring : [];
      snap.topSuggestions = Array.isArray(transfer.topSuggestions) ? transfer.topSuggestions : [];
    }
    // Dùng cache catalog nếu đã có (không block để tải)
    if (this.catalogCache?.count) {
      snap.catalogCount = this.catalogCache.count;
    }
    return snap;
  }

  private formatAge(iso: string): string {
    const ms = Date.now() - Date.parse(iso);
    if (isNaN(ms) || ms < 0) return "chưa rõ";
    const mins = Math.floor(ms / 60000);
    if (mins < 60) return `${mins} phút trước`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} giờ trước`;
    return `${Math.floor(hours / 24)} ngày trước`;
  }

  // ---------- Local factual answers (no LLM cost) ----------
  async tryLocalAnswer(question: string): Promise<string | null> {
    const q = question.toLowerCase().trim();

    if (/^(chào|hello|hi|xin chào)/.test(q)) {
      return "Chào bạn! Tôi có thể cho biết số liệu tồn kho, hàng hết, hàng key của các nhà thuốc, hoặc gợi ý làm báo cáo. Bạn muốn hỏi gì?";
    }

    const snap = await this.getDataSnapshot();
    if (snap.shopCount === 0) {
      return "Hiện tôi chưa đọc được dữ liệu tổng hợp từ Firebase. Bạn thử bấm nút Tải lại ở trang Tồn kho rồi hỏi lại nhé.";
    }

    if (/nhà thuốc|shop|cửa hàng/.test(q) && /bao nhiêu|mấy|danh sách|liệt kê/.test(q)) {
      return `Hệ thống đang quản lý ${snap.shopCount} nhà thuốc: ${snap.shopCodes.join(", ")}. Dữ liệu đồng bộ ${snap.dataAge}.`;
    }
    if (/hết hàng|out of stock|out-of-stock/.test(q)) {
      const lines = snap.shopCodes.map((c) => `${c}: ${snap.perShop[c].outOfStockCount}`).join(", ");
      return `Tổng ${snap.totals.outOfStock} sản phẩm hết hàng toàn hệ thống (${lines}). Dữ liệu ${snap.dataAge}.`;
    }
    if (/hàng key/.test(q) && /bao nhiêu|mấy/.test(q)) {
      return `Tổng ${snap.totals.key} sản phẩm hàng key toàn hệ thống. Dữ liệu ${snap.dataAge}.`;
    }
    if (/bán chậm|slow/.test(q)) {
      return `Tổng ${snap.totals.slow} sản phẩm bán chậm toàn hệ thống. Dữ liệu ${snap.dataAge}.`;
    }
    if (/bán chạy|lặp tốt|stable/.test(q)) {
      return `Tổng ${snap.totals.stable} sản phẩm bán chạy (lặp tốt) toàn hệ thống. Dữ liệu ${snap.dataAge}.`;
    }
    if (/đồng bộ|sync|cập nhật/.test(q) && /khi nào|lúc nào|mấy giờ|bao lâu/.test(q)) {
      return `Dữ liệu tổng hợp được đồng bộ ${snap.dataAge}${snap.fetchedAt ? ` (${snap.fetchedAt})` : ""}. Hệ thống tự sync mỗi giờ.`;
    }

    // --- Deep data patterns ---
    const deep = await this.getDeepSnapshot();

    // Tồn kho 1 sản phẩm cụ thể: "tồn kho paracetamol", "panadol còn bao nhiêu"
    const stockMatch = q.match(/(?:tồn kho|kho còn|con bao nhieu|còn bao nhiêu)\s+(.+)/) ||
      q.match(/(.+)\s+(?:tồn kho|còn bao nhiêu|con bao nhieu)\s*\??$/);
    if (stockMatch) {
      const name = stockMatch[1].trim();
      if (name.length >= 2) {
        const found = await this.lookupProduct(name);
        if (found) {
          const stock = await this.getNationalStock(found.c);
          if (stock) {
            const lines = stock.perShop.map((s) => `${s.shop}: ${s.qty.toLocaleString("vi-VN")}`).join(", ");
            return `${stock.name} (${stock.unit}): tổng tồn ${stock.totalQty.toLocaleString("vi-VN")} — ${lines}.`;
          }
          return `Tìm thấy ${found.n} nhưng chưa có dữ liệu tồn kho toàn quốc cho sản phẩm này.`;
        }
        return `Không tìm thấy sản phẩm "${name}" trong danh mục ${deep.catalogCount.toLocaleString("vi-VN")} sản phẩm. Bạn thử tên khác nhé.`;
      }
    }

    // Hàng cận date / hết hạn
    if (/cận date|can date|hết hạn|het han|sắp hết hạn|expir/.test(q)) {
      if (deep.expiringCount > 0) {
        return `Toàn hệ thống có ${deep.expiringCount.toLocaleString("vi-VN")} lô hàng cận date cần xử lý ` +
          `(nguy hiểm: ${deep.dangerQty.toLocaleString("vi-VN")}, cảnh báo: ${deep.warningQty.toLocaleString("vi-VN")}). ` +
          `Dữ liệu ${deep.deepAge}. Xem chi tiết ở trang Gợi ý chuyển hàng.`;
      }
      return null; // để Gemini trả lời chung chung
    }

    // Sản phẩm nào cận date gấp nhất
    if (/sản phẩm nào|loại nào|mặt hàng nào/.test(q) && /cận date|can date|hết hạn|het han|sắp hết|gấp|ưu tiên/.test(q)) {
      if (deep.topExpiring.length) {
        const lines = deep.topExpiring.slice(0, 10)
          .map((x, i) => `${i + 1}. ${x.n} — còn ${x.d} ngày, ${x.q} ${x.u} (${x.s})`).join("\n");
        return `Top 10 lô cần xử lý gấp nhất:\n${lines}\n(Dữ liệu ${deep.deepAge}.)`;
      }
      return null;
    }

    // Nên chuyển hàng nào đi đâu
    if (/chuyển.*đi đâu|đi đâu|nên chuyển|chuyển hàng nào/.test(q)) {
      if (deep.topSuggestions.length) {
        const lines = deep.topSuggestions.slice(0, 10)
          .map((x, i) => `${i + 1}. ${x.n}: ${x.f} → ${x.t} (${x.q} ${x.u})`).join("\n");
        return `Top 10 gợi ý điều chuyển:\n${lines}\n(Dữ liệu ${deep.deepAge}.)`;
      }
      return null;
    }

    // Gợi ý điều chuyển
    if (/điều chuyển|dieu chuyen|chuyển hàng|chuyen hang|gợi ý|goi y/.test(q) && /bao nhiêu|mấy|thống kê|tổng/.test(q)) {
      if (deep.suggestionCount > 0) {
        return `Hệ thống có ${deep.suggestionCount.toLocaleString("vi-VN")} gợi ý điều chuyển ` +
          `(${deep.suggestionGroups} nhóm sản phẩm). Dữ liệu ${deep.deepAge}. Xem chi tiết ở trang Gợi ý chuyển hàng.`;
      }
      return null;
    }

    // Danh mục sản phẩm
    if (/danh mục|danh muc|bao nhiêu sản phẩm|mấy sản phẩm|catalog/.test(q)) {
      if (deep.catalogCount > 0) {
        return `Danh mục toàn hệ thống có ${deep.catalogCount.toLocaleString("vi-VN")} sản phẩm đang kinh doanh. ` +
          `Bạn hỏi "tồn kho [tên sản phẩm]" để xem tồn kho toàn quốc nhé.`;
      }
      return null;
    }

    return null;
  }

  // ---------- Gemini ----------
  private buildSystemPrompt(snap: DataSnapshot): string {
    const perShopLines = snap.shopCodes
      .map((c) => {
        const s = snap.perShop[c];
        return `- ${c}: hết hàng ${s.outOfStockCount}, bán chạy ${s.stableCount}, bán chậm ${s.slowCount}, hàng key ${s.keyCount}`;
      })
      .join("\n");
    const today = new Date().toLocaleDateString("vi-VN", {
      weekday: "long",
      day: "numeric",
      month: "numeric",
      year: "numeric",
    });
    return `Bạn là trợ lý AI thân thiện cho hệ thống quản lý kho dược phẩm UPHARMA (nhà thuốc tại Việt Nam).
Hôm nay là ${today}.
Trả lời ngắn gọn, rõ ràng bằng tiếng Việt. Khi được hỏi về số liệu kho, dùng đúng số liệu dưới đây, không bịa thêm. Với mọi câu hỏi khác (ngày giờ, kiến thức chung, viết văn bản, tư vấn...), trả lời tự nhiên như một chatbot thông thường. Với câu trả lời dài, dùng markdown (tiêu đề, in đậm, gạch đầu dòng) cho dễ đọc.

DỮ LIỆU KHO HIỆN TẠI (đồng bộ ${snap.dataAge}):
- Số nhà thuốc: ${snap.shopCount} (${snap.shopCodes.join(", ")})
- Tổng hết hàng: ${snap.totals.outOfStock} | Bán chạy: ${snap.totals.stable} | Bán chậm: ${snap.totals.slow} | Hàng key: ${snap.totals.key}
- Danh mục: ${snap.catalogCount.toLocaleString("vi-VN")} sản phẩm
- Hàng cận date: ${snap.expiringCount.toLocaleString("vi-VN")} lô (nguy hiểm: ${snap.dangerQty.toLocaleString("vi-VN")}, cảnh báo: ${snap.warningQty.toLocaleString("vi-VN")})
- Gợi ý điều chuyển: ${snap.suggestionCount.toLocaleString("vi-VN")} gợi ý / ${snap.suggestionGroups} nhóm sản phẩm
Chi tiết từng shop:
${perShopLines || "(chưa có)"}
${snap.topExpiring.length ? `TOP ${snap.topExpiring.length} LÔ CẬN DATE GẤP NHẤT (tên | còn lại | SL | shop):
${snap.topExpiring.map((x) => `- ${x.n} | ${x.d} ngày | ${x.q} ${x.u} | ${x.s}`).join("\n")}` : ""}
${snap.topSuggestions.length ? `TOP ${snap.topSuggestions.length} GỢI Ý ĐIỀU CHUYỂN (sản phẩm | từ → đến | SL):
${snap.topSuggestions.map((x) => `- ${x.n} | ${x.f} → ${x.t} | ${x.q} ${x.u}`).join("\n")}` : ""}

Khi gợi ý báo cáo, đề xuất cụ thể theo vai trò quản lý nhà thuốc (tồn kho, FEFO/hạn dùng, hàng hết, hiệu suất bán, điều chuyển liên shop).`;
  }

  async ask(question: string, history: ChatMessage[]): Promise<string> {
    const key = this.getApiKey();
    if (!key) {
      throw new Error("NO_API_KEY");
    }
    const snap = await this.getDeepSnapshot();
    const contents = history
      .slice(-10)
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] }));
    contents.push({ role: "user", parts: [{ text: question }] });
    const body = JSON.stringify({
      system_instruction: { parts: [{ text: this.buildSystemPrompt(snap) }] },
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
    });

    // Retry với backoff cho lỗi tạm thời (429 quota, 503 quá tải)
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const callOnce = async (model: string): Promise<Response> => {
      // Dùng ?key= thay vì header x-goog-api-key: một số key (tạo qua Cloud Console,
      // bind service account) bị Google từ chối khi gửi qua header (400 API_KEY_INVALID)
      // nhưng chạy bình thường qua query param.
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
        `?key=${encodeURIComponent(key)}`;
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    };

    let modelNotFound = false;
    for (const model of this.MODELS) {
      let res: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        res = await callOnce(model);
        if (res.status !== 429 && res.status !== 503) break;
        await sleep(2000 * (attempt + 1)); // 2s, 4s
      }
      if (!res) continue;

      if (res.status === 404) {
        modelNotFound = true;
        continue; // thử model tiếp theo
      }
      if (res.status === 400) {
        throw new Error("API key không hợp lệ. Bạn kiểm tra lại key ở Google AI Studio nhé.");
      }
      if (res.status === 429) {
        throw new Error("Đã vượt quota miễn phí của Gemini. Thử lại sau ít phút.");
      }
      if (res.status === 503) {
        throw new Error("Máy chủ Gemini đang quá tải. Bạn đợi 1-2 phút rồi hỏi lại nhé.");
      }
      if (!res.ok) {
        throw new Error(`Gemini lỗi HTTP ${res.status}. Thử lại sau.`);
      }
      const json = await res.json();
      const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") || "";
      if (!text.trim()) {
        throw new Error("AI không trả lời được. Bạn thử hỏi lại theo cách khác nhé.");
      }
      return text.trim();
    }
    if (modelNotFound) {
      throw new Error("Key này chưa được bật model Gemini. Bạn vào aistudio.google.com → kiểm tra key còn hiệu lực không nhé.");
    }
    throw new Error("AI không trả lời được. Bạn thử lại sau nhé.");
  }
}
