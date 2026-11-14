import { Injectable } from "@angular/core";
import { environment } from "../environments/environment";

/**
 * Site-native staff accounts, stored in Realtime Database.
 *
 * There is deliberately no Firebase Authentication here: the main (manager)
 * account creates staff accounts itself on the "Tài khoản kiểm kê" page, the
 * accounts live in `staff_accounts/{key}` in the same database the app
 * already uses, and sign-in is verified in the browser against a salted
 * PBKDF2 password hash stored with the account. The session is kept in
 * localStorage, the same pattern as the main account's own session.
 *
 * What each account may do is decided by its record and enforced by the
 * Angular route guard and the menu:
 * - `shops`: the shops the account is responsible for (the inventory-count
 *   page only ever loads the slim catalog of these shops — code + name +
 *   unit, never system quantities or prices).
 * - `pages`: the route paths the account may open.
 *
 * Honest limits of this design (accepted by the manager): enforcement is
 * app-level, not database-rule level — the login flow must be able to read
 * the stored hash to verify a password, so the hashes are readable by anyone
 * who knows the database address. Staff passwords must therefore be at least
 * 4 characters and unique to this app. Locking an account (`active: false`)
 * takes effect at the next sign-in check.
 */

/** One row of `staff_accounts`, as managed from the admin page. */
export interface StaffUserRecord {
  /** Stable account id used in sessions and count submissions (= username). */
  uid: string;
  username: string;
  displayName: string;
  shops: string[];
  /** Route paths this account may open, assigned by the manager. */
  pages: string[];
  active: boolean;
}

/** A page the manager may grant to a staff account. */
export interface StaffPageOption {
  path: string;
  label: string;
  icon: string;
}

/**
 * Pages a staff account can be granted. Deliberately excludes the management
 * pages (settings, account management, reports, targets) — those stay with
 * the main account.
 */
export const STAFF_PAGE_OPTIONS: StaffPageOption[] = [
  { path: "kiem-ke", label: "Kiểm kê", icon: "ti-clipboard-check" },
  { path: "dashboard", label: "Dashboard", icon: "ti-home" },
  { path: "ton-kho", label: "Tồn kho", icon: "ti-package" },
  { path: "ton-kho-toan-quoc", label: "Tồn kho toàn quốc", icon: "ti-world" },
  { path: "fefo", label: "FEFO", icon: "ti-calendar" },
  { path: "hang-da-het", label: "Hàng đã hết", icon: "ti-package-off" },
  { path: "hang-lap-tot", label: "Hàng lặp tốt", icon: "ti-repeat" },
  { path: "hang-key", label: "Hàng key", icon: "ti-key" },
  { path: "goi-y-chuyen-hang", label: "Gợi ý chuyển hàng", icon: "ti-arrows-exchange" },
];

export const DEFAULT_STAFF_PAGES = ["kiem-ke"];

export interface StaffSession {
  uid: string;
  username: string;
  displayName: string;
  shops: string[];
  /** Route paths this account may open. */
  pages: string[];
  signedInAt: number;
}

interface StoredPassword {
  salt: string;
  hash: string;
  iterations: number;
}

interface StoredStaffAccount {
  username?: string;
  displayName?: string;
  password?: StoredPassword;
  shops?: Record<string, unknown> | string[];
  pages?: unknown;
  active?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

const SESSION_STORAGE_KEY = "upharma_staff_session";
const STAFF_USERNAME_PATTERN = /^[a-z0-9._-]+$/;
const PBKDF2_ITERATIONS = 120_000;
const MIN_STAFF_PASSWORD_LENGTH = 4;

/** Database key for a username (RTDB keys cannot contain . $ # [ ] /). */
export function staffAccountKey(username: string): string {
  return username
    .trim()
    .toLowerCase()
    .replace(/[%.$#[\]/]/g, (character) => {
      return "%" + character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
    });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** PBKDF2-SHA256 password hash; generates a fresh salt when none is given. */
export async function hashStaffPassword(
  password: string,
  saltBase64?: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<StoredPassword> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Trình duyệt không hỗ trợ mã hóa mật khẩu (cần HTTPS).");
  }
  const salt = saltBase64 ? base64ToBytes(saltBase64) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return {
    salt: bytesToBase64(salt),
    hash: bytesToBase64(new Uint8Array(derived)),
    iterations,
  };
}

async function verifyStaffPassword(password: string, stored: StoredPassword): Promise<boolean> {
  const candidate = await hashStaffPassword(password, stored.salt, stored.iterations);
  const expected = base64ToBytes(stored.hash);
  const actual = base64ToBytes(candidate.hash);
  if (expected.length !== actual.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) {
    difference |= expected[index] ^ actual[index];
  }
  return difference === 0;
}

@Injectable({ providedIn: "root" })
export class StaffAuthService {
  private get dbUrl(): string {
    return environment.firebaseDbUrl.replace(/\/+$/, "");
  }

  // ---------------------------------------------------------------- session

  getSession(): StaffSession | null {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StaffSession;
      if (
        !parsed ||
        typeof parsed.username !== "string" ||
        typeof parsed.displayName !== "string" ||
        !Array.isArray(parsed.shops) ||
        !Array.isArray(parsed.pages) ||
        typeof parsed.signedInAt !== "number"
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  hasSession(): boolean {
    return this.getSession() !== null;
  }

  signOut(): void {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }

  // --------------------------------------------------------------- sign-in

  /**
   * Whether a staff account with this username exists. Lookup failures
   * (network, rules not deployed yet) count as "no" so the main login flow
   * can safely fall back to the upstream Upharma API.
   */
  async hasStaffAccount(username: string): Promise<boolean> {
    try {
      return (await this.readAccount(username.trim().toLowerCase())) !== null;
    } catch {
      return false;
    }
  }

  async signIn(username: string, password: string): Promise<StaffSession> {
    const normalized = username.trim().toLowerCase();
    const account = await this.readAccount(normalized);
    if (!account || !account.password) {
      throw new Error("Tên đăng nhập hoặc mật khẩu không đúng.");
    }
    const matches = await verifyStaffPassword(password, account.password);
    if (!matches) {
      throw new Error("Tên đăng nhập hoặc mật khẩu không đúng.");
    }
    if (account.active === false) {
      throw new Error("Tài khoản đã bị khóa. Liên hệ quản lý để mở lại.");
    }

    const session: StaffSession = {
      uid: String(account.username || normalized),
      username: normalized,
      displayName: String(account.displayName || normalized),
      shops: this.parseShops(account.shops),
      pages: this.parsePages(account.pages),
      signedInAt: Date.now(),
    };
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    return session;
  }

  // ------------------------------------------------------- account manager

  async createStaffAccount(input: {
    username: string;
    password: string;
    displayName: string;
    shops: string[];
    pages: string[];
  }): Promise<StaffUserRecord> {
    const username = input.username.trim().toLowerCase();
    if (!STAFF_USERNAME_PATTERN.test(username)) {
      throw new Error(
        "Tên đăng nhập chỉ gồm chữ thường, số, dấu chấm, gạch ngang hoặc gạch dưới (không dấu, không khoảng trắng).",
      );
    }
    if (input.password.length < MIN_STAFF_PASSWORD_LENGTH) {
      throw new Error(`Mật khẩu nhân viên phải có ít nhất ${MIN_STAFF_PASSWORD_LENGTH} ký tự.`);
    }
    if (await this.readAccount(username)) {
      throw new Error(`Tên đăng nhập "${username}" đã tồn tại.`);
    }

    const stored: StoredStaffAccount = {
      username,
      displayName: input.displayName.trim(),
      password: await hashStaffPassword(input.password),
      shops: this.toShopMap(input.shops),
      pages: this.parsePages(input.pages),
      active: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await this.writeAccount(username, stored);
    return this.toRecord(stored);
  }

  async listStaffUsers(): Promise<StaffUserRecord[]> {
    const response = await fetch(`${this.dbUrl}/staff_accounts.json`);
    if (!response.ok) {
      throw new Error(
        response.status === 401 || response.status === 403
          ? "Chưa đọc được danh sách tài khoản — rules của database chưa có node staff_accounts. Đợi bản đồng bộ tiếp theo tự cập nhật rules, hoặc dán rules trong Firebase Console (xem docs/staff-inventory-count.md)."
          : `Không tải được danh sách tài khoản (mã ${response.status}).`,
      );
    }
    const data = (await response.json().catch(() => null)) as Record<string, StoredStaffAccount> | null;
    if (!data) return [];
    return Object.values(data)
      .filter((account) => account && typeof account.username === "string")
      .map((account) => this.toRecord(account))
      .sort((first, second) => first.username.localeCompare(second.username));
  }

  /**
   * Writes back the mutable fields of an account (display name, shops,
   * pages, active). When `newPassword` is non-empty the password hash is
   * replaced too; the stored hash is otherwise preserved untouched.
   */
  async updateStaffUser(record: StaffUserRecord, newPassword?: string): Promise<void> {
    const current = await this.readAccount(record.username);
    if (!current) {
      throw new Error("Không tìm thấy tài khoản để cập nhật.");
    }
    if (newPassword) {
      if (newPassword.length < MIN_STAFF_PASSWORD_LENGTH) {
        throw new Error(`Mật khẩu mới phải có ít nhất ${MIN_STAFF_PASSWORD_LENGTH} ký tự.`);
      }
      current.password = await hashStaffPassword(newPassword);
    }
    current.displayName = record.displayName;
    current.shops = this.toShopMap(record.shops);
    current.pages = this.parsePages(record.pages);
    current.active = record.active;
    current.updatedAt = Date.now();
    await this.writeAccount(record.username, current);
  }

  async deleteStaffAccount(username: string): Promise<void> {
    const normalized = username.trim().toLowerCase();
    const response = await fetch(
      `${this.dbUrl}/staff_accounts/${encodeURIComponent(staffAccountKey(normalized))}.json`,
      {
        method: "DELETE",
      },
    );
    if (!response.ok) {
      throw new Error(
        response.status === 401 || response.status === 403
          ? "Chưa xóa được tài khoản — rules của database chưa cho phép node staff_accounts. Đợi bản đồng bộ tiếp theo tự cập nhật rules, hoặc dán rules trong Firebase Console (xem docs/staff-inventory-count.md)."
          : `Không xóa được tài khoản (mã ${response.status}).`,
      );
    }
  }

  // ---------------------------------------------------------------- helpers

  private async readAccount(username: string): Promise<StoredStaffAccount | null> {
    const response = await fetch(
      `${this.dbUrl}/staff_accounts/${encodeURIComponent(staffAccountKey(username))}.json`,
    );
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "Chưa truy cập được tài khoản nhân viên — rules của database chưa có node staff_accounts. Đợi bản đồng bộ tiếp theo tự cập nhật rules, hoặc dán rules trong Firebase Console (xem docs/staff-inventory-count.md).",
      );
    }
    if (!response.ok) return null;
    return (await response.json().catch(() => null)) as StoredStaffAccount | null;
  }

  private async writeAccount(username: string, account: StoredStaffAccount): Promise<void> {
    const response = await fetch(
      `${this.dbUrl}/staff_accounts/${encodeURIComponent(staffAccountKey(username))}.json`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(account),
      },
    );
    if (!response.ok) {
      throw new Error(
        response.status === 401 || response.status === 403
          ? "Chưa ghi được tài khoản — rules của database chưa cho phép node staff_accounts. Đợi bản đồng bộ tiếp theo tự cập nhật rules, hoặc dán rules trong Firebase Console (xem docs/staff-inventory-count.md)."
          : `Không lưu được tài khoản (mã ${response.status}).`,
      );
    }
  }

  private toRecord(account: StoredStaffAccount): StaffUserRecord {
    const username = String(account.username || "");
    return {
      uid: username,
      username,
      displayName: String(account.displayName || username),
      shops: this.parseShops(account.shops),
      pages: this.parsePages(account.pages),
      active: account.active !== false,
    };
  }

  private parseShops(raw: StoredStaffAccount["shops"]): string[] {
    if (Array.isArray(raw)) {
      return raw.map((code) => String(code)).filter(Boolean);
    }
    if (raw && typeof raw === "object") {
      return Object.entries(raw)
        .filter(([, allowed]) => allowed === true || allowed === "true")
        .map(([code]) => code);
    }
    return [];
  }

  private toShopMap(shops: string[]): Record<string, boolean> {
    const map: Record<string, boolean> = {};
    for (const code of shops) map[code] = true;
    return map;
  }

  private parsePages(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [...DEFAULT_STAFF_PAGES];
    const known = new Set(STAFF_PAGE_OPTIONS.map((option) => option.path));
    const pages = raw.map((page) => String(page)).filter((page) => known.has(page));
    return pages.length ? pages : [...DEFAULT_STAFF_PAGES];
  }
}
