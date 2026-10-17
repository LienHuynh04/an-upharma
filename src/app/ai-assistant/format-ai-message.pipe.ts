import { Pipe, PipeTransform } from "@angular/core";
import { DomSanitizer, SafeHtml } from "@angular/platform-browser";

/**
 * Render markdown cơ bản của AI thành HTML (đã escape để chống XSS).
 * Pure pipe: chỉ tính lại khi text đầu vào đổi, tránh gọi hàm mỗi chu kỳ change detection.
 */
@Pipe({ name: "formatAiMessage", standalone: true, pure: true })
export class FormatAiMessagePipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}

  transform(text: string): SafeHtml {
    if (!text) return this.sanitizer.bypassSecurityTrustHtml("");
    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    // Code block ```...```
    html = html.replace(/```([\s\S]*?)```/g, (_m, code) => `<pre><code>${String(code).trim()}</code></pre>`);
    // Inline code `...`
    html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    // Bold **...** và __...__
    html = html.replace(/\*\*([^\*\n]+)\*\*/g, "<strong>$1</strong>");
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
