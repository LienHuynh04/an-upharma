/**
 * Chuẩn hóa key dùng cho Firebase Realtime Database.
 *
 * RTDB không cho phép các ký tự `. $ # [ ] /` trong key. Mọi chỗ trong app
 * (service + script sync) PHẢI dùng helper này thay vì tự viết regex,
 * để tránh "key drift" — ghi bằng 1 kiểu sanitize, đọc bằng 1 kiểu khác.
 */
export function sanitizeFirebaseKey(key: string | null | undefined): string {
  return String(key ?? "")
    .trim()
    .replace(/[.$#\[\]\/]/g, "_");
}
