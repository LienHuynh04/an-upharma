import { Injectable } from "@angular/core";
import { environment } from "../../environments/environment";
import { UpharmaService } from "../upharma.service";

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

export interface DataSnapshot {
  fetchedAt: string | null;
  dataAge: string;
  shopCount: number;
  shopCodes: string[];
  perShop: Record<string, ShopSummary>;
  totals: { outOfStock: number; stable: number; slow: number; key: number };
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
  private readonly MODELS = ["gemini-2.0-flash", "gemini-1.5-flash"];
  private snapshotCache: { at: number; data: DataSnapshot } | null = null;
  private readonly SNAPSHOT_TTL_MS = 5 * 60 * 1000;

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

  /** True when the key comes from environment (no manual setup needed). */
  hasBuiltInKey(): boolean {
    return String((environment as any).geminiApiKey || "").trim().length > 0;
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
    };
    try {
      const base = (environment as any).firebaseDbUrl?.replace(/\/$/, "");
      if (!base) return empty;
      const res = await fetch(`${base}/shops_summary.json`);
      if (!res.ok) return empty;
      const json = await res.json();
      const data = json?.data || {};
      const codes = Object.keys(data);
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
      };
      this.snapshotCache = { at: Date.now(), data: snap };
      return snap;
    } catch {
      return this.snapshotCache?.data || empty;
    }
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
    return `Bạn là trợ lý AI cho hệ thống quản lý kho dược phẩm UPHARMA (nhà thuốc tại Việt Nam).
Trả lời ngắn gọn, rõ ràng bằng tiếng Việt. Khi được hỏi về số liệu, dùng đúng số liệu dưới đây, không bịa thêm.

DỮ LIỆU HIỆN TẠI (đồng bộ ${snap.dataAge}):
- Số nhà thuốc: ${snap.shopCount} (${snap.shopCodes.join(", ")})
- Tổng hết hàng: ${snap.totals.outOfStock} | Bán chạy: ${snap.totals.stable} | Bán chậm: ${snap.totals.slow} | Hàng key: ${snap.totals.key}
Chi tiết từng shop:
${perShopLines || "(chưa có)"}

Khi gợi ý báo cáo, đề xuất cụ thể theo vai trò quản lý nhà thuốc (tồn kho, FEFO/hạn dùng, hàng hết, hiệu suất bán).`;
  }

  async ask(question: string, history: ChatMessage[]): Promise<string> {
    const key = this.getApiKey();
    if (!key) {
      throw new Error("NO_API_KEY");
    }
    const snap = await this.getDataSnapshot();
    const contents = history
      .slice(-10)
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] }));
    contents.push({ role: "user", parts: [{ text: question }] });
    const body = JSON.stringify({
      system_instruction: { parts: [{ text: this.buildSystemPrompt(snap) }] },
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 },
    });

    let modelNotFound = false;
    for (const model of this.MODELS) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body,
        }
      );

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
