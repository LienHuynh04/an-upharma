import { Injectable } from "@angular/core";
import { environment } from "../environments/environment";

export type RawRecord = Record<string, unknown>;

export interface ShopInfo {
  ShopCode: string;
  ShopName: string;
  EmRole?: string;
  ShopAddress?: string;
  GroupMail?: string;
  PhoneNumber?: string;
}

export interface UserInfo {
  uPharmaID: number;
  Email?: string;
  FullName: string;
  ShopLst: ShopInfo[];
}

export interface LoginResponse {
  RespCode: number;
  RespText: string;
  Token: string;
  UserInfo: UserInfo;
}

export interface ResourceResponse {
  success: boolean;
  resource: string;
  user: {
    uPharmaID: number;
    FullName: string;
    Email?: string;
  };
  shops: ShopInfo[];
  data: RawRecord[];
  failedShops: string[];
  fetchedAt: string;
}

export interface UserProfileResponse {
  user: RawRecord;
  raw: unknown;
}

export interface RemoteDatasets {
  inventory?: ResourceResponse;
  invoices?: ResourceResponse;
  messages?: ResourceResponse;
  employees?: ResourceResponse;
  orders?: ResourceResponse;
}

interface ResourceConfig {
  pathname: string;
  payload: () => RawRecord;
}

interface CachedResource {
  savedAt: number;
  data: ResourceResponse;
}

interface CachedCall {
  savedAt: number;
  data: unknown;
}

@Injectable({ providedIn: "root" })
export class UpharmaService {
  readonly resourceNames = ["inventory", "invoices", "messages", "employees", "orders"] as const;

  private readonly authStorageKey = "upharma_session";
  private readonly cacheStorageKeyPrefix = "upharma_cache_";
  private readonly callCacheKeyPrefix = "upharma_call_";
  private readonly cacheTtlMs = 5 * 60 * 1000;
  private readonly callCacheTtlMs = 10 * 60 * 1000;
  private readonly shopConcurrency = 6;
  private readonly apiBaseUrl = environment.apiBaseUrl.replace(/\/$/, "");
  private readonly directApiBaseUrl = environment.directApiBaseUrl.replace(/\/$/, "");
  private readonly useBackendProxy = environment.useBackendProxy;
  private readonly inFlightResources = new Map<string, Promise<ResourceResponse>>();
  private readonly inFlightCalls = new Map<string, Promise<unknown>>();
  private sessionData: LoginResponse | null = null;
  private shopList: ShopInfo[] = [];

  async login(credentials: { UserName: string; Password: string }): Promise<LoginResponse> {
    if (!credentials.UserName || !credentials.Password) {
      throw new Error("Vui lòng nhập tài khoản và mật khẩu");
    }

    if ((environment as any).useStaticData) {
      const response = await fetch(this.getStaticDataUrl("assets/data/login.json"));
      if (!response.ok) throw new Error("Chưa có data tĩnh, vui lòng chờ cronjob hoặc kiểm tra lại đường dẫn");
      const loginData = await response.json() as LoginResponse;
      this.setSession(loginData);
      if (this.shopList.length === 0) throw new Error("Phiên đăng nhập không có nhà thuốc hợp lệ");
      return loginData;
    }

    const loginData = this.useBackendProxy
      ? await this.backendLogin(credentials)
      : await this.request<LoginResponse>("/User/UserLogin", {
          UserName: credentials.UserName,
          Password: credentials.Password,
        });

    if (!loginData.Token || !loginData.UserInfo?.uPharmaID || !Array.isArray(loginData.UserInfo.ShopLst)) {
      throw new Error(loginData.RespText || "Response đăng nhập không hợp lệ");
    }

    this.setSession(loginData);

    if (this.shopList.length === 0) {
      throw new Error("Phiên đăng nhập không có nhà thuốc hợp lệ");
    }

    return loginData;
  }

  getActiveShops(): ShopInfo[] {
    return this.shopList;
  }

  getSession(): LoginResponse | null {
    return this.sessionData || this.restoreSession();
  }

  isAuthenticated(): boolean {
    return Boolean(this.getSession());
  }

  clearSession(): void {
    this.sessionData = null;
    this.shopList = [];
    localStorage.removeItem(this.authStorageKey);
    this.clearResourceCache();
  }

  ensureLogin(): LoginResponse {
    const session = this.getSession();

    if (!session) {
      throw new Error("Chưa đăng nhập UPHARMA");
    }

    return session;
  }

  async callEndpoint<T>(
    pathname: string,
    payload: RawRecord,
    options: { cache?: boolean; forceRefresh?: boolean } = {},
  ): Promise<T> {
    if ((environment as any).useStaticData) {
      if (pathname.includes("GetReportSalesSpeed")) {
        const response = await fetch(this.getStaticDataUrl("assets/data/sales_speed.json"));
        if (!response.ok) throw new Error("Không thể đọc data tĩnh của sales_speed");
        const json = await response.json();
        
        const dataArr = (json as any).data || (json as any).DataLst || (json as any).Rows || [];
        if (Array.isArray(dataArr) && dataArr.length === 0) {
          this.triggerGithubCronjob();
        }

        return json as T;
      }
      throw new Error(`API endpoint ${pathname} không được hỗ trợ ở chế độ tĩnh`);
    }

    const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;

    if (!options.cache) {
      return this.request<T>(normalizedPath, payload);
    }

    const cacheKey = this.getCallCacheKey(normalizedPath, payload);

    if (!options.forceRefresh) {
      const cached = this.readCallCache(cacheKey);

      if (cached) {
        return cached as T;
      }
    }

    const pending = this.inFlightCalls.get(cacheKey);

    if (pending) {
      return pending as Promise<T>;
    }

    const request = this.request<T>(normalizedPath, payload)
      .then((data) => {
        this.writeCallCache(cacheKey, data);
        return data;
      })
      .finally(() => {
        this.inFlightCalls.delete(cacheKey);
      });

    this.inFlightCalls.set(cacheKey, request);

    return request;
  }

  private async triggerGithubCronjob(): Promise<void> {
    const lastTrigger = localStorage.getItem('last_auto_cronjob');
    if (lastTrigger && Date.now() - parseInt(lastTrigger) < 5 * 60 * 1000) {
      return; // Do not trigger more than once every 5 minutes
    }
    
    const githubPat = localStorage.getItem('github_pat');
    if (!githubPat) {
      console.warn("Không có Github PAT để tự động kích hoạt cronjob.");
      return;
    }

    try {
      localStorage.setItem('last_auto_cronjob', Date.now().toString());
      console.log("Dữ liệu tĩnh trống, đang tự động kích hoạt Github Action...");
      
      const response = await fetch('https://api.github.com/repos/LienHuynh04/an-upharma/actions/workflows/fetch-data.yml/dispatches', {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `Bearer ${githubPat}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: 'master'
        })
      });

      if (!response.ok) {
        throw new Error(`Lỗi gọi GitHub API: ${response.status} ${response.statusText}`);
      }
      
      console.log("Đã gửi lệnh chạy Cronjob thành công!");
    } catch (err) {
      console.error("Lỗi khi kích hoạt tự động cronjob:", err);
    }
  }

  prefetchSalesSpeed(): void {
    const session = this.sessionData;

    if (!session) {
      return;
    }

    const shops = [...this.shopList];
    const requests = shops.flatMap((shop) =>
      this.getSalesSpeedPrefetchPayloads(session, shop.ShopCode).map((payload) => ({ payload })),
    );

    void this.runWithConcurrency(requests, async ({ payload }) => {
      try {
        await this.callEndpoint("/SalesInvoice/GetReportSalesSpeed", payload, { cache: true });
      } catch (error) {
        console.warn("Prefetch GetReportSalesSpeed thất bại:", error);
      }
    });
  }

  async getUserInfoByID(): Promise<UserProfileResponse> {
    const session = this.ensureLogin();
    const payload = {
      Token: session.Token,
      uPharmaID: session.UserInfo.uPharmaID,
    };
    const response = await this.callEndpoint<unknown>("/User/GetUserInfoByID", payload);

    return {
      user: this.extractObject(response),
      raw: response,
    };
  }

  formatUpharmaDateTime(date: Date): string {
    return this.formatDateTime(date);
  }

  async loadAllResources(options: { onFresh?: (datasets: RemoteDatasets) => void } = {}): Promise<RemoteDatasets> {
    const datasets: RemoteDatasets = {};
    const settled = await Promise.all(
      this.resourceNames.map(async (resourceName) => {
        try {
          return {
            resourceName,
            data: await this.fetchResource(resourceName, {
              onFresh: options.onFresh
                ? (fresh) => {
                    datasets[resourceName] = fresh;
                    options.onFresh?.({ ...datasets });
                  }
                : undefined,
            }),
          };
        } catch (error) {
          console.warn(`Không tải được API ${resourceName}:`, error);
          return { resourceName, data: null };
        }
      }),
    );

    for (const entry of settled) {
      if (entry.data) {
        datasets[entry.resourceName] = entry.data;
      }
    }

    return datasets;
  }

  async loadInventoryResource(
    options: { onFresh?: (data: ResourceResponse) => void; forceRefresh?: boolean } = {},
  ): Promise<ResourceResponse> {
    if (!this.sessionData) {
      this.ensureLogin();
    }

    return this.fetchResource("inventory", options);
  }

  clearResourceCache(): void {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(this.cacheStorageKeyPrefix) || key.startsWith(this.callCacheKeyPrefix)) {
        localStorage.removeItem(key);
      }
    }
  }

  private setSession(loginData: LoginResponse): void {
    this.sessionData = loginData;
    this.shopList = loginData.UserInfo.ShopLst.filter(
      (shop) => !environment.excludedShopCodes.includes(shop.ShopCode),
    ).sort((firstShop, secondShop) => firstShop.ShopCode.localeCompare(secondShop.ShopCode, "vi"));

    localStorage.setItem(
      this.authStorageKey,
      JSON.stringify({
        loginDate: this.getTodayKey(),
        session: loginData,
      }),
    );
  }

  private restoreSession(): LoginResponse | null {
    const rawSession = localStorage.getItem(this.authStorageKey);

    if (!rawSession) {
      return null;
    }

    try {
      const parsedSession = JSON.parse(rawSession) as { loginDate?: string; session?: LoginResponse };

      if (parsedSession.loginDate !== this.getTodayKey() || !parsedSession.session?.Token) {
        this.clearSession();
        return null;
      }

      this.setSession(parsedSession.session);
      return parsedSession.session;
    } catch {
      this.clearSession();
      return null;
    }
  }

  private getTodayKey(): string {
    return this.formatDateTime(new Date()).slice(0, 10);
  }

  private async fetchResource(
    resourceName: keyof RemoteDatasets,
    options: { onFresh?: (data: ResourceResponse) => void; forceRefresh?: boolean } = {},
  ): Promise<ResourceResponse> {
    const session = this.sessionData;

    if (!session) {
      throw new Error("Chưa đăng nhập UPHARMA");
    }

    if (!this.getResourceConfig(resourceName)) {
      throw new Error(`Không hỗ trợ nhóm API: ${resourceName}`);
    }

    if ((environment as any).useStaticData) {
      const response = await fetch(this.getStaticDataUrl(`assets/data/${resourceName}.json`));
      if (!response.ok) throw new Error(`Không thể đọc data tĩnh của ${resourceName}`);
      const data = await response.json() as ResourceResponse;
      if (options.onFresh) options.onFresh(data);
      return data;
    }

    if (this.useBackendProxy) {
      return this.requestBackendResource(resourceName, session);
    }

    const cacheKey = this.getResourceCacheKey(resourceName, session);
    const cached = options.forceRefresh ? null : this.readResourceCache(cacheKey);
    const revalidate = this.dedupeResourceFetch(cacheKey, resourceName, session);

    if (!cached) {
      return revalidate;
    }

    if (options.onFresh) {
      revalidate
        .then((fresh) => options.onFresh?.(fresh))
        .catch((error) => console.warn(`Không làm mới được API ${resourceName}:`, error));
    }

    return cached;
  }

  private dedupeResourceFetch(
    cacheKey: string,
    resourceName: keyof RemoteDatasets,
    session: LoginResponse,
  ): Promise<ResourceResponse> {
    const pending = this.inFlightResources.get(cacheKey);

    if (pending) {
      return pending;
    }

    const request = this.fetchResourceFromApi(resourceName, session)
      .then((data) => {
        this.writeResourceCache(cacheKey, data);
        return data;
      })
      .finally(() => {
        this.inFlightResources.delete(cacheKey);
      });

    this.inFlightResources.set(cacheKey, request);

    return request;
  }

  private async fetchResourceFromApi(
    resourceName: keyof RemoteDatasets,
    session: LoginResponse,
  ): Promise<ResourceResponse> {
    const config = this.getResourceConfig(resourceName)!;
    const data: RawRecord[] = [];
    const failedShops: string[] = [];
    const shops = [...this.shopList];

    const worker = async (): Promise<void> => {
      for (let shop = shops.shift(); shop; shop = shops.shift()) {
        try {
          const responseData = await this.request<RawRecord>(config.pathname, {
            ...config.payload(),
            Token: session.Token,
            uPharmaID: String(session.UserInfo.uPharmaID),
            ShopCode: shop.ShopCode,
          });

          data.push(
            ...this.extractArray(responseData).map((item) => ({
              ...item,
              __shopCode: shop.ShopCode,
              __shopName: shop.ShopName,
            })),
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failedShops.push(`${shop.ShopCode}: ${message}`);
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(this.shopConcurrency, this.shopList.length) }, () => worker()),
    );

    if (this.shopList.length > 0 && failedShops.length === this.shopList.length) {
      throw new Error(`${resourceName}: tất cả nhà thuốc đều lỗi (${failedShops.join(", ")})`);
    }

    return {
      success: true,
      resource: resourceName,
      user: {
        uPharmaID: session.UserInfo.uPharmaID,
        FullName: session.UserInfo.FullName,
        Email: session.UserInfo.Email,
      },
      shops: this.shopList,
      data,
      failedShops,
      fetchedAt: new Date().toISOString(),
    };
  }

  private getSalesSpeedPrefetchPayloads(session: LoginResponse, shopCode: string): RawRecord[] {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 0);
    const monthWindow = 3;
    const monthStart = new Date(now.getFullYear(), now.getMonth() - monthWindow + 1, 1, 0, 0, 0);
    const base = {
      uPharmaID: session.UserInfo.uPharmaID,
      Token: session.Token,
      ProductID: "",
      ViewCity: 0,
      ShopLst: shopCode,
    };

    return [
      {
        ...base,
        TimeStart: this.formatDateTime(todayStart),
        TimeEnd: this.formatDateTime(todayEnd),
        GetType: "Week",
      },
      {
        ...base,
        TimeStart: this.formatDateTime(monthStart),
        TimeEnd: this.formatDateTime(todayEnd),
        GetType: "Week",
      },
    ];
  }

  private async runWithConcurrency<T>(items: T[], handler: (item: T) => Promise<void>): Promise<void> {
    const queue = [...items];
    const worker = async (): Promise<void> => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        await handler(item);
      }
    };

    await Promise.all(Array.from({ length: Math.min(this.shopConcurrency, items.length) }, () => worker()));
  }

  private getCallCacheKey(pathname: string, payload: RawRecord): string {
    const stablePayload = Object.fromEntries(
      Object.entries(payload)
        .filter(([key]) => key !== "Token")
        .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey)),
    );

    return `${this.callCacheKeyPrefix}${pathname}_${JSON.stringify(stablePayload)}`;
  }

  private readCallCache(cacheKey: string): unknown | null {
    try {
      const rawCache = localStorage.getItem(cacheKey);

      if (!rawCache) {
        return null;
      }

      const entry = JSON.parse(rawCache) as CachedCall;

      if (!entry.savedAt || Date.now() - entry.savedAt > this.callCacheTtlMs) {
        localStorage.removeItem(cacheKey);
        return null;
      }

      return entry.data;
    } catch {
      localStorage.removeItem(cacheKey);
      return null;
    }
  }

  private writeCallCache(cacheKey: string, data: unknown): void {
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), data } satisfies CachedCall));
    } catch {
      this.clearResourceCache();
    }
  }

  private getResourceCacheKey(resourceName: keyof RemoteDatasets, session: LoginResponse): string {
    const shopCodes = this.shopList.map((shop) => shop.ShopCode).join(",");
    const config = this.getResourceConfig(resourceName)!;

    return `${this.cacheStorageKeyPrefix}${resourceName}_${session.UserInfo.uPharmaID}_${shopCodes}_${JSON.stringify(config.payload())}`;
  }

  private readResourceCache(cacheKey: string): ResourceResponse | null {
    try {
      const rawCache = localStorage.getItem(cacheKey);

      if (!rawCache) {
        return null;
      }

      const entry = JSON.parse(rawCache) as CachedResource;

      if (!entry.savedAt || Date.now() - entry.savedAt > this.cacheTtlMs) {
        localStorage.removeItem(cacheKey);
        return null;
      }

      return entry.data;
    } catch {
      localStorage.removeItem(cacheKey);
      return null;
    }
  }

  private writeResourceCache(cacheKey: string, data: ResourceResponse): void {
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), data } satisfies CachedResource));
    } catch {
      this.clearResourceCache();
    }
  }

  private async request<T>(pathname: string, payload: RawRecord): Promise<T> {
    if (this.useBackendProxy) {
      return this.requestViaBackend<T>(pathname, payload);
    }

    const response = await fetch(`${this.directApiBaseUrl}${pathname}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const responseText = await response.text();
    let data: RawRecord;

    try {
      data = responseText ? (JSON.parse(responseText) as RawRecord) : {};
    } catch {
      throw new Error(`${pathname}: response không phải JSON`);
    }

    if (!response.ok) {
      throw new Error(`${pathname}: HTTP ${response.status}`);
    }

    if (Object.hasOwn(data, "RespCode") && Number(data["RespCode"]) !== 0) {
      throw new Error(String(data["RespText"] || `${pathname}: RespCode ${data["RespCode"]}`));
    }

    return data as T;
  }

  private async backendLogin(credentials: { UserName: string; Password: string }): Promise<LoginResponse> {
    const response = await fetch(`${this.apiBaseUrl}/login`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(credentials),
    });

    return this.parseApiResponse<LoginResponse>(response, "/api/upharma/login");
  }

  private async requestViaBackend<T>(pathname: string, payload: RawRecord): Promise<T> {
    const response = await fetch(`${this.apiBaseUrl}/call`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pathname,
        payload,
      }),
    });
    const proxyData = await this.parseApiResponse<RawRecord>(response, "/api/upharma/call");
    const data = (proxyData["data"] || proxyData) as RawRecord;

    this.assertBusinessResponse(pathname, data);

    return data as T;
  }

  private async requestBackendResource(resourceName: keyof RemoteDatasets, session: LoginResponse): Promise<ResourceResponse> {
    const response = await fetch(`${this.apiBaseUrl}/resource`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        resourceName,
        Token: session.Token,
        uPharmaID: session.UserInfo.uPharmaID,
        FullName: session.UserInfo.FullName,
        Email: session.UserInfo.Email,
        shops: this.shopList,
      }),
    });

    return this.parseApiResponse<ResourceResponse>(response, `/api/upharma/resource/${resourceName}`);
  }

  private async parseApiResponse<T>(response: Response, pathname: string): Promise<T> {
    const responseText = await response.text();
    let data: RawRecord;

    try {
      data = responseText ? (JSON.parse(responseText) as RawRecord) : {};
    } catch {
      throw new Error(`${pathname}: response không phải JSON`);
    }

    if (!response.ok) {
      throw new Error(String(data["message"] || data["RespText"] || `${pathname}: HTTP ${response.status}`));
    }

    this.assertBusinessResponse(pathname, data);

    return data as T;
  }

  private assertBusinessResponse(pathname: string, data: RawRecord): void {
    if (Object.hasOwn(data, "RespCode") && Number(data["RespCode"]) !== 0) {
      throw new Error(String(data["RespText"] || `${pathname}: RespCode ${data["RespCode"]}`));
    }
  }

  private extractArray(data: unknown): RawRecord[] {
    if (Array.isArray(data)) {
      return data.filter((item): item is RawRecord => Boolean(item) && typeof item === "object");
    }

    if (!data || typeof data !== "object") {
      return [];
    }

    const record = data as RawRecord;
    const preferredKeys = ["Data", "data", "DataLst", "ListData", "InventoryLst", "InventoryList", "Table", "Rows"];

    for (const key of preferredKeys) {
      const value = record[key];

      if (Array.isArray(value)) {
        return value.filter((item): item is RawRecord => Boolean(item) && typeof item === "object");
      }
    }

    const queue = Object.values(record).filter((value) => value && typeof value === "object");

    while (queue.length > 0) {
      const value = queue.shift();

      if (Array.isArray(value)) {
        return value.filter((item): item is RawRecord => Boolean(item) && typeof item === "object");
      }

      if (value && typeof value === "object") {
        queue.push(...Object.values(value as RawRecord).filter((item) => item && typeof item === "object"));
      }
    }

    return [];
  }

  private extractObject(data: unknown): RawRecord {
    if (!data || typeof data !== "object") {
      return {};
    }

    const record = data as RawRecord;
    const preferredKeys = ["Data", "data", "UserInfo", "User", "Info", "Profile"];

    for (const key of preferredKeys) {
      const value = record[key];

      if (value && typeof value === "object" && !Array.isArray(value)) {
        return value as RawRecord;
      }
    }

    return record;
  }

  private getResourceConfig(resourceName: keyof RemoteDatasets): ResourceConfig | null {
    const now = new Date();
    const currentTime = this.formatDateTime(now);
    const today = currentTime.slice(0, 10);
    const twoMonthsAgo = new Date(now);
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

    const configs: Record<keyof RemoteDatasets, ResourceConfig> = {
      inventory: {
        pathname: "/LocalStore/GetInventoryByShopID",
        payload: () => ({ ProductID: "", LotCode: "", StoreType: "" }),
      },
      invoices: {
        pathname: "/InvoiceOnline/GetInvoiceOrderOnByTime",
        payload: () => ({ TimeStart: `${today} 06:00:00`, TimeEnd: `${today} 23:59:00` }),
      },
      messages: {
        pathname: "/NTMessage/GetMessageByTime",
        payload: () => ({ TimeStart: this.formatDateTime(twoMonthsAgo), TimeEnd: currentTime }),
      },
      employees: {
        pathname: "/Employee/GetEmployeeOfShop",
        payload: () => ({}),
      },
      orders: {
        pathname: "/SalesInvoice/GetOrderHeaderByShop",
        payload: () => ({
          TimeStart: `${today} 06:00:00`,
          TimeEnd: currentTime,
          PageNumber: 1,
          NumberRow: 0,
        }),
      },
    };

    return configs[resourceName] || null;
  }

  private formatDateTime(date: Date): string {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

    return `${values["year"]}-${values["month"]}-${values["day"]} ${values["hour"]}:${values["minute"]}:${values["second"]}`;
  }

  private getStaticDataUrl(filename: string): string {
    const basePath = document.querySelector('base')?.getAttribute('href') || '/';
    const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
    return `${normalizedBase}${filename}`;
  }
}
