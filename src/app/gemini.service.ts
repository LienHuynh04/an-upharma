import { Injectable } from "@angular/core";
import { environment } from "../environments/environment";

@Injectable({
  providedIn: "root",
})
export class GeminiService {
  private get backendUrl(): string {
    const base = environment.useBackendProxy 
      ? environment.apiBaseUrl 
      : "http://localhost:3000";
    return `${base.replace(/\/$/, "")}/api/gemini/analyze`;
  }

  constructor() {}

  /**
   * Gửi prompt phân tích qua Backend proxy bảo mật.
   * Dữ liệu nhạy cảm (số điện thoại) sẽ được ẩn danh ở cả phía máy khách và máy chủ.
   */
  async analyzeData(prompt: string): Promise<{ success: boolean; result: string }> {
    if (!prompt) {
      throw new Error("Prompt phân tích không được để trống.");
    }

    const sanitizedPrompt = this.anonymizeClientText(prompt);

    try {
      const response = await fetch(this.backendUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt: sanitizedPrompt }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || `Lỗi HTTP ${response.status}`);
      }

      return data;
    } catch (error) {
      console.error("[Gemini Service] Lỗi phân tích AI:", error);
      throw error;
    }
  }

  private anonymizeClientText(text: string): string {
    if (!text) return "";
    return text.replace(/(?:\+84|0)\s*\d{2,3}[\s.-]*\d{3,4}[\s.-]*\d{3,4}/g, (match) => {
      const cleaned = match.replace(/[\s.-]/g, '');
      if (cleaned.length >= 8) {
        return cleaned.slice(0, 3) + "***" + cleaned.slice(-3);
      }
      return "***";
    });
  }
}
