import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, ViewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { AiAssistantService, ChatMessage } from "./ai-assistant.service";
import { FormatAiMessagePipe } from "./format-ai-message.pipe";

@Component({
  selector: "app-ai-chat",
  standalone: true,
  imports: [CommonModule, FormsModule, FormatAiMessagePipe],
  templateUrl: "./ai-chat.component.html",
  styleUrl: "./ai-chat.component.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
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
    private cdr: ChangeDetectorRef
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
    this.cdr.markForCheck();
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
      this.cdr.markForCheck();
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

}
