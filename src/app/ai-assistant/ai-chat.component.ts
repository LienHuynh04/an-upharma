import { CommonModule } from "@angular/common";
import { Component, ElementRef, ViewChild } from "@angular/core";
import { DomSanitizer, SafeHtml } from "@angular/platform-browser";
import { FormsModule } from "@angular/forms";
import { AiAssistantService, ChatMessage } from "./ai-assistant.service";

@Component({
  selector: "app-ai-chat",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./ai-chat.component.html",
  styleUrl: "./ai-chat.component.css",
})
export class AiChatComponent {
  isOpen = false;
  messages: ChatMessage[] = [];
  inputText = "";
  sending = false;
  greeted = false;
  keyMissing = false;

  quickChips = [
    "Sản phẩm nào cận date gấp nhất?",
    "Nên chuyển hàng nào đi đâu?",
    "Tồn kho Panadol",
    "Gợi ý báo cáo tuần này",
  ];

  @ViewChild("msgList") msgList?: ElementRef<HTMLElement>;
  @ViewChild("chatInput") chatInput?: ElementRef<HTMLInputElement>;

  constructor(
    public ai: AiAssistantService,
    private sanitizer: DomSanitizer
  ) {}

  toggle(): void {
    this.isOpen = !this.isOpen;
    if (this.isOpen && !this.greeted) {
      this.greeted = true;
      if (!this.ai.hasApiKey()) {
        this.keyMissing = true;
        this.pushAssistant(
          "Trợ lý AI chưa được cấu hình API key. Vui lòng liên hệ quản trị viên."
        );
      } else {
        this.pushAssistant(
          "Chào bạn! Tôi là trợ lý AI của UPHARMA. Hỏi tôi về tồn kho sản phẩm, hàng cận date, điều chuyển, hoặc nhờ gợi ý báo cáo nhé."
        );
      }
    }
    if (this.isOpen) {
      setTimeout(() => this.chatInput?.nativeElement.focus(), 100);
    }
  }

  close(): void {
    this.isOpen = false;
  }

  private pushAssistant(text: string): void {
    this.messages.push({ role: "assistant", text });
    this.scrollDown();
  }

  private scrollDown(): void {
    setTimeout(() => {
      const el = this.msgList?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);
  }

  sendChip(chip: string): void {
    this.inputText = chip;
    this.send();
  }

  async send(): Promise<void> {
    const text = this.inputText.trim();
    if (!text || this.sending) return;
    if (!this.ai.hasApiKey()) {
      this.keyMissing = true;
      this.pushAssistant("Trợ lý AI chưa được cấu hình API key. Vui lòng liên hệ quản trị viên.");
      return;
    }
    this.inputText = "";
    this.messages.push({ role: "user", text });
    this.scrollDown();
    this.sending = true;
    try {
      // 1. Thử trả lời từ số liệu có sẵn (nhanh, miễn phí)
      const local = await this.ai.tryLocalAnswer(text);
      if (local) {
        this.pushAssistant(local);
        return;
      }
      // 2. Câu hỏi mở → hỏi Gemini
      const answer = await this.ai.ask(text, this.messages.slice(0, -1));
      this.pushAssistant(answer);
    } catch (e: any) {
      if (e?.message === "NO_API_KEY") {
        this.keyMissing = true;
        this.pushAssistant("Trợ lý AI chưa được cấu hình API key. Vui lòng liên hệ quản trị viên.");
      } else {
        this.pushAssistant(e?.message || "Có lỗi xảy ra, bạn thử lại nhé.");
      }
    } finally {
      this.sending = false;
      this.scrollDown();
    }
  }

  onInputKey(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void this.send();
    }
  }

  trackByIdx(index: number): number {
    return index;
  }

  /** Render markdown cơ bản của AI thành HTML (đã escape để chống XSS). */
  formatMessage(text: string): SafeHtml {
    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    // Code block ```...```
    html = html.replace(/```([\s\S]*?)```/g, (_m, code) => `<pre><code>${code.trim()}</code></pre>`);
    // Inline code `...`
    html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    // Bold **...** và __...__
    html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
    // Italic *...* (tránh nhầm với list) — không dùng lookbehind để tương thích Safari cũ
    html = html.replace(/(^|\W)\*([^\*\n]+)\*(?!\w)/g, "$1<em>$2</em>");
    // Headings ### / ## / #
    html = html.replace(/^####\s+(.+)$/gm, "<h5>$1</h5>");
    html = html.replace(/^###\s+(.+)$/gm, "<h4>$1</h4>");
    html = html.replace(/^##\s+(.+)$/gm, "<h4>$1</h4>");
    // Unordered list
    html = html.replace(/^(?:[-*]\s+.+\n?)+/gm, (block) => {
      const items = block.trim().split("\n").map((l) => `<li>${l.replace(/^[-*]\s+/, "")}</li>`).join("");
      return `<ul>${items}</ul>`;
    });
    // Ordered list
    html = html.replace(/^(?:\d+\.\s+.+\n?)+/gm, (block) => {
      const items = block.trim().split("\n").map((l) => `<li>${l.replace(/^\d+\.\s+/, "")}</li>`).join("");
      return `<ol>${items}</ol>`;
    });
    // Xuống dòng còn lại
    html = html.replace(/\n/g, "<br>");
    // Dọn <br> thừa quanh block elements
    html = html.replace(/(<\/(?:ul|ol|h4|h5|pre)>|<ul>|<ol>)<br>/g, "$1");
    html = html.replace(/<br>(<(?:ul|ol|li|h4|h5|pre))/g, "$1");
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }
}
