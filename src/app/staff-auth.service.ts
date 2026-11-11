import { Injectable } from "@angular/core";
import { environment } from "../environments/environment";

/**
 * Staff sign-in for the inventory-count (kiem ke) feature, built on Firebase
 * Authentication's REST API so the app needs no extra SDK dependency.
 *
 * Accounts are created by the manager in the Firebase Console. A staff member
 * signs in with a short username; the app maps it to the Firebase email
 * `<username>@an-upharma.local`. After sign-in the app reads the role record
 * at `staff_users/{uid}` in Realtime Database:
 *   { displayName: string, role: "counter" | "admin",
 *     shops: { SHOP0025: true, ... }, active: true }
 *
 * - role "counter": the account may only open the inventory-count page, only
 *   for the shops listed in its record, and only sees the slim shop catalog
 *   (product code + name + unit, never quantities or prices).
 * - role "admin": the manager's own Firebase account. The manager still signs
 *   in with the Upharma account as before; the app then silently tries the
 *   same credentials against Firebase so the manager can read the count
 *   results staff submit. A failed Firebase sign-in never blocks the manager.
 *
 * Setup steps: docs/staff-inventory-count.md.
 */

export type StaffRole = "counter" | "admin";

export interface StaffSession {
  uid: string;
  username: string;
  displayName: string;
  role: StaffRole;
  shops: string[];
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}

/** One row of `staff_users`, as managed from the admin page. */
export interface StaffUserRecord {
  uid: string;
  username: string;
  displayName: string;
  role: StaffRole;
  shops: string[];
  active: boolean;
}

const SESSION_STORAGE_KEY = "upharma_staff_session";
export const STAFF_EMAIL_DOMAIN = "an-upharma.local";

export function staffEmailForUsername(username: string): string {
  return `${username.trim().toLowerCase()}@${STAFF_EMAIL_DOMAIN}`;
}

interface FirebaseSignInResponse {
  localId: string;
  idToken: string;
  refreshToken: string;
  expiresIn: string;
}

@Injectable({ providedIn: "root" })
export class StaffAuthService {
  private get apiKey(): string {
    return (environment.firebaseApiKey || "").trim();
  }

  private get dbUrl(): string {
    return environment.firebaseDbUrl.replace(/\/+$/, "");
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async signIn(username: string, password: string): Promise<StaffSession> {
    if (!this.isConfigured) {
      throw new Error(
        "Chưa cấu hình Firebase API key cho đăng nhập nhân viên (environment.firebaseApiKey). Xem docs/staff-inventory-count.md.",
      );
    }
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: staffEmailForUsername(username),
          password,
          returnSecureToken: true,
        }),
      },
    );
    const data = (await response.json().catch(() => null)) as
      | (FirebaseSignInResponse & { error?: { message?: string } })
      | null;
    if (!response.ok || !data?.idToken || !data.localId) {
      throw new Error(this.signInErrorText(data?.error?.message));
    }

    const profile = await this.fetchProfile(data.localId, data.idToken);
    if (!profile) {
      throw new Error(
        "Tài khoản chưa được cấp quyền kiểm kê trên hệ thống. Liên hệ quản lý để được cấp quyền.",
      );
    }

    const session: StaffSession = {
      uid: data.localId,
      username: username.trim().toLowerCase(),
      displayName: profile.displayName,
      role: profile.role,
      shops: profile.shops,
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000,
    };
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    return session;
  }

  /**
   * Best-effort Firebase sign-in with the manager's Upharma credentials, so a
   * manager whose Firebase account uses the same password gets an admin token
   * transparently. Never throws and never blocks the normal login flow.
   */
  async trySignInSilently(username: string, password: string): Promise<boolean> {
    try {
      await this.signIn(username, password);
      return true;
    } catch {
      return false;
    }
  }

  getSession(): StaffSession | null {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw) as StaffSession;
      if (!session?.uid || !session.idToken || !session.refreshToken) return null;
      return session;
    } catch {
      return null;
    }
  }

  hasSession(): boolean {
    return this.getSession() !== null;
  }

  isStaff(): boolean {
    return this.getSession()?.role === "counter";
  }

  isAdmin(): boolean {
    return this.getSession()?.role === "admin";
  }

  /** Returns an ID token that is valid for at least ~5 more minutes. */
  async getValidIdToken(): Promise<string> {
    const session = this.getSession();
    if (!session) {
      throw new Error("Chưa đăng nhập tài khoản nhân viên.");
    }
    if (session.expiresAt - Date.now() > 5 * 60 * 1000) {
      return session.idToken;
    }
    const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${this.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: session.refreshToken,
      }),
    });
    const data = (await response.json().catch(() => null)) as
      | { id_token?: string; refresh_token?: string; expires_in?: string }
      | null;
    if (!response.ok || !data?.id_token) {
      this.signOut();
      throw new Error("Phiên đăng nhập nhân viên đã hết hạn. Đăng nhập lại giúp mình nhé.");
    }
    const updated: StaffSession = {
      ...session,
      idToken: data.id_token,
      refreshToken: data.refresh_token || session.refreshToken,
      expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
    };
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(updated));
    return updated.idToken;
  }

  signOut(): void {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }

  // ---- Admin: staff account management (requires an admin session) ----

  /**
   * Creates a Firebase Auth user (email/password sign-up) and its role record.
   * The sign-up response tokens belong to the new user and are discarded —
   * the manager's own session in localStorage is never touched.
   */
  async createStaffAccount(input: {
    username: string;
    password: string;
    displayName: string;
    shops: string[];
  }): Promise<StaffUserRecord> {
    if (!this.isConfigured) {
      throw new Error(
        "Chưa cấu hình Firebase API key (environment.firebaseApiKey). Xem docs/staff-inventory-count.md.",
      );
    }
    const username = input.username.trim().toLowerCase();
    if (!/^[a-z0-9._-]+$/.test(username)) {
      throw new Error("Tên đăng nhập chỉ gồm chữ thường, số và dấu . _ - (không dấu, không khoảng trắng).");
    }
    if (input.password.length < 6) {
      throw new Error("Mật khẩu phải có ít nhất 6 ký tự.");
    }
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: staffEmailForUsername(username),
          password: input.password,
          returnSecureToken: true,
        }),
      },
    );
    const data = (await response.json().catch(() => null)) as
      | { localId?: string; error?: { message?: string } }
      | null;
    if (!response.ok || !data?.localId) {
      throw new Error(this.createAccountErrorText(data?.error?.message));
    }
    const record: StaffUserRecord = {
      uid: data.localId,
      username,
      displayName: input.displayName.trim(),
      role: "counter",
      shops: [...input.shops],
      active: true,
    };
    await this.writeStaffUser(record);
    return record;
  }

  async listStaffUsers(): Promise<StaffUserRecord[]> {
    const idToken = await this.getValidIdToken();
    const response = await fetch(
      `${this.dbUrl}/staff_users.json?auth=${encodeURIComponent(idToken)}`,
    );
    if (!response.ok) {
      throw new Error(`Không tải được danh sách tài khoản nhân viên (mã ${response.status}).`);
    }
    const data = (await response.json().catch(() => null)) as Record<
      string,
      Record<string, unknown>
    > | null;
    if (!data) return [];
    return Object.entries(data)
      .map(([uid, raw]) => this.toStaffUserRecord(uid, raw))
      .sort((first, second) => first.displayName.localeCompare(second.displayName, "vi"));
  }

  /** Updates a role record (e.g. activate/deactivate, change shops). */
  async updateStaffUser(record: StaffUserRecord): Promise<void> {
    await this.writeStaffUser(record);
  }

  private async writeStaffUser(record: StaffUserRecord): Promise<void> {
    const idToken = await this.getValidIdToken();
    const shops: Record<string, boolean> = {};
    for (const code of record.shops) shops[code] = true;
    const response = await fetch(
      `${this.dbUrl}/staff_users/${encodeURIComponent(record.uid)}.json?auth=${encodeURIComponent(idToken)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: record.username,
          displayName: record.displayName,
          role: record.role,
          shops,
          active: record.active,
        }),
      },
    );
    if (!response.ok) {
      throw new Error(
        `Không lưu được tài khoản nhân viên (mã ${response.status}). Kiểm tra quyền quản lý Firebase của bạn.`,
      );
    }
  }

  private toStaffUserRecord(uid: string, raw: Record<string, unknown>): StaffUserRecord {
    const shopsRaw = raw["shops"];
    let shops: string[] = [];
    if (Array.isArray(shopsRaw)) {
      shops = shopsRaw.map((code) => String(code)).filter(Boolean);
    } else if (shopsRaw && typeof shopsRaw === "object") {
      shops = Object.entries(shopsRaw as Record<string, unknown>)
        .filter(([, allowed]) => allowed === true || allowed === "true")
        .map(([code]) => code);
    }
    return {
      uid,
      username: String(raw["username"] || ""),
      displayName: String(raw["displayName"] || raw["name"] || ""),
      role: raw["role"] === "admin" ? "admin" : "counter",
      shops,
      active: raw["active"] !== false,
    };
  }

  private createAccountErrorText(code: string | undefined): string {
    switch (code) {
      case "EMAIL_EXISTS":
        return "Tên đăng nhập này đã có tài khoản. Chọn tên khác.";
      case "WEAK_PASSWORD : Password should be at least 6 characters":
      case "WEAK_PASSWORD":
        return "Mật khẩu quá yếu — cần ít nhất 6 ký tự.";
      case "OPERATION_NOT_ALLOWED":
        return "Firebase chưa bật đăng nhập Email/Password. Bật trong Firebase Console → Authentication → Sign-in method.";
      default:
        return "Không tạo được tài khoản nhân viên. Kiểm tra mạng rồi thử lại.";
    }
  }

  private async fetchProfile(
    uid: string,
    idToken: string,
  ): Promise<{ displayName: string; role: StaffRole; shops: string[] } | null> {
    const response = await fetch(
      `${this.dbUrl}/staff_users/${encodeURIComponent(uid)}.json?auth=${encodeURIComponent(idToken)}`,
    );
    if (!response.ok) return null;
    const raw = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!raw || raw["active"] === false) return null;

    const shopsRaw = raw["shops"];
    let shops: string[] = [];
    if (Array.isArray(shopsRaw)) {
      shops = shopsRaw.map((code) => String(code)).filter(Boolean);
    } else if (shopsRaw && typeof shopsRaw === "object") {
      shops = Object.entries(shopsRaw as Record<string, unknown>)
        .filter(([, allowed]) => allowed === true || allowed === "true")
        .map(([code]) => code);
    }

    return {
      displayName: String(raw["displayName"] || raw["name"] || ""),
      role: raw["role"] === "admin" ? "admin" : "counter",
      shops,
    };
  }

  private signInErrorText(code: string | undefined): string {
    switch (code) {
      case "EMAIL_NOT_FOUND":
      case "INVALID_PASSWORD":
      case "INVALID_LOGIN_CREDENTIALS":
        return "Sai tài khoản hoặc mật khẩu nhân viên.";
      case "USER_DISABLED":
        return "Tài khoản nhân viên đã bị khóa. Liên hệ quản lý.";
      case "TOO_MANY_ATTEMPTS_TRY_LATER":
        return "Đăng nhập sai quá nhiều lần. Thử lại sau ít phút.";
      default:
        return "Không đăng nhập được tài khoản nhân viên. Kiểm tra mạng rồi thử lại.";
    }
  }
}
