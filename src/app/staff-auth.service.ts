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
 * - role "counter": a staff account. It may open only the pages the manager
 *   granted it in its record (`pages`, e.g. just the inventory-count page),
 *   only for the shops listed in its record, and the inventory-count page in
 *   this mode only ever receives the slim shop catalog (product code + name +
 *   unit, never quantities or prices).
 * - role "admin": the shared management account (`quantri@an-upharma.local`)
 *   the accounts page uses to create/manage staff accounts and read submitted
 *   counts. The manager unlocks it with a management password from the
 *   accounts page — see {@link StaffAuthService.unlockManagement}.
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
  /** Route paths this account may open (empty for the management account). */
  pages: string[];
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
 * the main account. Page grants are enforced by the route guard and the menu;
 * the inventory-count data itself is additionally enforced by database rules.
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

/** Username of the shared management account used by the accounts page. */
export const MANAGEMENT_USERNAME = "quantri";

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
      pages: profile.pages,
      idToken: data.idToken,
      refreshToken: data.refreshToken,
      expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000,
    };
    this.saveSession(session);
    return session;
  }

  private saveSession(session: StaffSession): void {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  }

  /**
   * Unlocks staff-account management with the shared management account
   * (`quantri@an-upharma.local`) — no per-manager Firebase account and no
   * Console step:
   *
   * - First time (account does not exist yet): creates the management account
   *   with the password the manager sets, claims the create-once
   *   `system_admin` node (database rules accept the claim only while the
   *   node does not exist, so exactly one management account can ever be
   *   created this way), and writes its admin role record.
   * - Later: simply signs in with that management password. The session is
   *   persisted in the browser, so the password is only needed again when
   *   the session is gone (new browser, cleared data).
   *
   * Only a signed-in main (Upharma) account can open the accounts page, so
   * in practice the management password is set by the manager; recovering a
   * forgotten one means deleting `system_admin` and the `quantri` user in
   * the Firebase Console and setting it up again.
   */
  async unlockManagement(input: {
    password: string;
    displayName: string;
    shops: string[];
  }): Promise<StaffSession> {
    if (!this.isConfigured) {
      throw new Error(
        "Chưa cấu hình Firebase API key (environment.firebaseApiKey). Xem docs/staff-inventory-count.md.",
      );
    }
    if (input.password.length < 6) {
      throw new Error("Mật khẩu quản trị phải có ít nhất 6 ký tự.");
    }
    const auth = await this.signUpOrSignIn(MANAGEMENT_USERNAME, input.password);

    const session: StaffSession = {
      uid: auth.localId,
      username: MANAGEMENT_USERNAME,
      displayName: input.displayName.trim() || "Quản trị",
      role: "admin",
      shops: [...input.shops],
      pages: [],
      idToken: auth.idToken,
      refreshToken: auth.refreshToken,
      expiresAt: Date.now() + Number(auth.expiresIn || 3600) * 1000,
    };

    await this.claimSystemAdmin(session);
    await this.writeStaffUser(
      {
        uid: session.uid,
        username: MANAGEMENT_USERNAME,
        displayName: session.displayName,
        role: "admin",
        shops: session.shops,
        pages: [],
        active: true,
      },
      session.idToken,
    );
    this.saveSession(session);
    return session;
  }

  /** Signs up a new Firebase user; falls back to sign-in when it exists. */
  private async signUpOrSignIn(
    username: string,
    password: string,
  ): Promise<FirebaseSignInResponse> {
    const email = staffEmailForUsername(username);
    const signUpResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      },
    );
    const signUpData = (await signUpResponse.json().catch(() => null)) as
      | (FirebaseSignInResponse & { error?: { message?: string } })
      | null;
    if (signUpResponse.ok && signUpData?.idToken && signUpData.localId) {
      return signUpData;
    }
    if (signUpData?.error?.message !== "EMAIL_EXISTS") {
      throw new Error(this.signInErrorText(signUpData?.error?.message));
    }
    // Account already created (e.g. a previous interrupted attempt): sign in.
    const signInResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      },
    );
    const signInData = (await signInResponse.json().catch(() => null)) as
      | (FirebaseSignInResponse & { error?: { message?: string } })
      | null;
    if (!signInResponse.ok || !signInData?.idToken || !signInData.localId) {
      throw new Error(this.signInErrorText(signInData?.error?.message));
    }
    return signInData;
  }

  /**
   * Claims the create-once `system_admin` node for this session's uid.
   * Succeeds silently when the claim already belongs to the same uid
   * (resuming an interrupted link); fails when someone else holds it.
   */
  private async claimSystemAdmin(session: StaffSession): Promise<void> {
    const readResponse = await fetch(
      `${this.dbUrl}/system_admin.json?auth=${encodeURIComponent(session.idToken)}`,
    );
    const existing = (await readResponse.json().catch(() => null)) as { uid?: string } | null;
    if (existing?.uid) {
      if (existing.uid === session.uid) return;
      throw new Error(
        "Quyền quản lý Firebase đã được liên kết bởi một tài khoản khác. Nếu đó không phải bạn, xóa node system_admin trong Firebase Console rồi thử lại.",
      );
    }
    const writeResponse = await fetch(
      `${this.dbUrl}/system_admin.json?auth=${encodeURIComponent(session.idToken)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uid: session.uid,
          username: session.username,
          claimedAt: Date.now(),
        }),
      },
    );
    if (!writeResponse.ok) {
      throw new Error(
        "Không ghi được quyền quản lý (có thể vừa có người liên kết trước bạn). Tải lại trang rồi thử lại.",
      );
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
    pages: string[];
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
      pages: this.parsePages(input.pages),
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

  private async writeStaffUser(record: StaffUserRecord, providedIdToken?: string): Promise<void> {
    const idToken = providedIdToken || (await this.getValidIdToken());
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
          pages: record.pages || [],
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
      pages: this.parsePages(raw["pages"]),
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

  private parsePages(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [...DEFAULT_STAFF_PAGES];
    const known = new Set(STAFF_PAGE_OPTIONS.map((option) => option.path));
    const pages = raw.map((page) => String(page)).filter((page) => known.has(page));
    return pages.length ? pages : [...DEFAULT_STAFF_PAGES];
  }

  private async fetchProfile(
    uid: string,
    idToken: string,
  ): Promise<{ displayName: string; role: StaffRole; shops: string[]; pages: string[] } | null> {
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
      pages: this.parsePages(raw["pages"]),
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
