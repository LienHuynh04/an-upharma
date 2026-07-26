const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "http://localhost:5678/webhook/demo";
const UPHARMA_API_BASE_URL = process.env.UPHARMA_API_BASE_URL || "https://icpc1hn.work/NHATHUOC";
const UPHARMA_USERNAME = process.env.UPHARMA_USERNAME || "";
const UPHARMA_PASSWORD = process.env.UPHARMA_PASSWORD || "";
const UPHARMA_CACHE_TTL_MS = Number(process.env.UPHARMA_CACHE_TTL_MS || 300000);
const UPHARMA_CACHE_DIR = process.env.UPHARMA_CACHE_DIR
  ? path.resolve(__dirname, process.env.UPHARMA_CACHE_DIR)
  : path.join(__dirname, ".cache");
const EXCLUDED_SHOP_CODES = new Set(
  (process.env.UPHARMA_EXCLUDED_SHOPS || "SHOP0040")
    .split(",")
    .map((shopCode) => shopCode.trim())
    .filter(Boolean),
);
const UPHARMA_RESOURCE_ROUTES = new Map([
  ["/api/upharma/inventory", "inventory"],
  ["/api/upharma/invoices", "invoices"],
  ["/api/upharma/messages", "messages"],
  ["/api/upharma/employees", "employees"],
  ["/api/upharma/orders", "orders"],
]);

let upharmaSessionCache = null;
let upharmaSessionPromise = null;
const upharmaResourceCache = new Map();
const upharmaResourcePromises = new Map();
const upharmaRequestCache = new Map();
const upharmaRequestPromises = new Map();

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);

  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let rawBody = "";

    req.on("data", (chunk) => {
      rawBody += chunk;
    });

    req.on("end", () => {
      if (!rawBody) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(rawBody));
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function sanitizeCachePayload(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeCachePayload(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !["token", "password"].includes(key.toLowerCase()))
        .map(([key, item]) => [key, sanitizeCachePayload(item)]),
    );
  }

  return value;
}

function makeCacheKey(scope, payload) {
  const rawKey = stableStringify({
    scope,
    payload: sanitizeCachePayload(payload),
  });

  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

function getCacheFilePath(cacheKey) {
  return path.join(UPHARMA_CACHE_DIR, `${cacheKey}.json`);
}

async function readDiskCache(cacheKey, ttlMs = UPHARMA_CACHE_TTL_MS) {
  const memoryCache = upharmaRequestCache.get(cacheKey);
  const now = Date.now();

  if (memoryCache && memoryCache.expiresAt > now) {
    return {
      hit: true,
      data: memoryCache.data,
      savedAt: memoryCache.savedAt,
      source: "memory",
    };
  }

  try {
    const cacheText = await fs.promises.readFile(getCacheFilePath(cacheKey), "utf8");
    const cacheEntry = JSON.parse(cacheText);

    if (!cacheEntry.savedAt || now - cacheEntry.savedAt > ttlMs) {
      return { hit: false };
    }

    upharmaRequestCache.set(cacheKey, {
      data: cacheEntry.data,
      savedAt: cacheEntry.savedAt,
      expiresAt: cacheEntry.savedAt + ttlMs,
    });

    return {
      hit: true,
      data: cacheEntry.data,
      savedAt: cacheEntry.savedAt,
      source: "disk",
    };
  } catch {
    return { hit: false };
  }
}

async function writeDiskCache(cacheKey, data, ttlMs = UPHARMA_CACHE_TTL_MS) {
  const savedAt = Date.now();

  upharmaRequestCache.set(cacheKey, {
    data,
    savedAt,
    expiresAt: savedAt + ttlMs,
  });

  await fs.promises.mkdir(UPHARMA_CACHE_DIR, { recursive: true });
  await fs.promises.writeFile(
    getCacheFilePath(cacheKey),
    JSON.stringify({ cacheKey, savedAt, data }, null, 2),
  );

  return savedAt;
}

function extractArray(data) {
  if (Array.isArray(data)) {
    return data;
  }

  if (!data || typeof data !== "object") {
    return [];
  }

  const preferredKeys = ["Data", "data", "DataLst", "ListData", "InventoryLst", "InventoryList", "Table", "Rows"];

  for (const key of preferredKeys) {
    if (Array.isArray(data[key])) {
      return data[key];
    }
  }

  const queue = Object.values(data).filter((value) => value && typeof value === "object");

  while (queue.length > 0) {
    const value = queue.shift();

    if (Array.isArray(value)) {
      return value;
    }

    queue.push(...Object.values(value).filter((item) => item && typeof item === "object"));
  }

  return [];
}

async function requestUpharma(pathname, payload) {
  const response = await fetch(`${UPHARMA_API_BASE_URL}${pathname}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: "https://upharma.com.vn",
      Referer: "https://upharma.com.vn/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const error = new Error(`UPHARMA ${pathname} trả về HTTP ${response.status}`);
    error.statusCode = response.status;
    error.responseData = data;
    throw error;
  }

  return data;
}

async function getCachedUpharmaRequest(pathname, payload, options = {}) {
  const ttlMs = Number(options.ttlMs || UPHARMA_CACHE_TTL_MS);
  const cacheKey = makeCacheKey("upharma-call", { pathname, payload });
  const cached = await readDiskCache(cacheKey, ttlMs);

  if (cached.hit) {
    return {
      data: cached.data,
      cached: true,
      cacheSource: cached.source,
      cachedAt: new Date(cached.savedAt).toISOString(),
      cacheKey,
    };
  }

  if (!upharmaRequestPromises.has(cacheKey)) {
    const requestPromise = requestUpharma(pathname, payload)
      .then(async (data) => {
        const savedAt = await writeDiskCache(cacheKey, data, ttlMs);

        return {
          data,
          cached: false,
          cachedAt: new Date(savedAt).toISOString(),
          cacheKey,
        };
      })
      .finally(() => {
        upharmaRequestPromises.delete(cacheKey);
      });

    upharmaRequestPromises.set(cacheKey, requestPromise);
  }

  return upharmaRequestPromises.get(cacheKey);
}

async function fetchUpharmaSession() {
  if (!UPHARMA_USERNAME || !UPHARMA_PASSWORD) {
    const error = new Error("Thiếu UPHARMA_USERNAME hoặc UPHARMA_PASSWORD trong backend/.env");
    error.statusCode = 503;
    throw error;
  }

  const loginData = await requestUpharma("/User/UserLogin", {
    UserName: UPHARMA_USERNAME,
    Password: UPHARMA_PASSWORD,
  });
  const allShops = loginData.UserInfo?.ShopLst || [];

  if (loginData.RespCode !== 0 || !loginData.Token || allShops.length === 0) {
    const error = new Error(loginData.RespText || "Đăng nhập UPHARMA thất bại");
    error.statusCode = 502;
    throw error;
  }

  return {
    token: loginData.Token,
    user: {
      uPharmaID: loginData.UserInfo.uPharmaID,
      FullName: loginData.UserInfo.FullName,
      Email: loginData.UserInfo.Email,
    },
    shops: allShops.filter((shop) => !EXCLUDED_SHOP_CODES.has(shop.ShopCode)),
    fetchedAt: new Date().toISOString(),
  };
}

async function getUpharmaSession() {
  const now = Date.now();

  if (upharmaSessionCache && upharmaSessionCache.expiresAt > now) {
    return upharmaSessionCache.data;
  }

  if (!upharmaSessionPromise) {
    upharmaSessionPromise = fetchUpharmaSession()
      .then((data) => {
        upharmaSessionCache = {
          data,
          expiresAt: Date.now() + UPHARMA_CACHE_TTL_MS,
        };
        return data;
      })
      .finally(() => {
        upharmaSessionPromise = null;
      });
  }

  return upharmaSessionPromise;
}

function formatDateTime(date) {
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

  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

function getResourceConfig(resourceName, now = new Date()) {
  const currentTime = formatDateTime(now);
  const today = currentTime.slice(0, 10);
  const twoMonthsAgo = new Date(now);
  twoMonthsAgo.setUTCMonth(twoMonthsAgo.getUTCMonth() - 2);

  const configs = {
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
      payload: () => ({ TimeStart: formatDateTime(twoMonthsAgo), TimeEnd: currentTime }),
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

  return configs[resourceName];
}

async function fetchUpharmaResource(resourceName) {
  const session = await getUpharmaSession();
  const config = getResourceConfig(resourceName);

  if (!config) {
    const error = new Error(`Không hỗ trợ resource UPHARMA: ${resourceName}`);
    error.statusCode = 404;
    throw error;
  }

  return fetchUpharmaResourceWithSession(resourceName, {
    token: session.token,
    user: session.user,
    shops: session.shops,
  });
}

async function fetchUpharmaResourceWithSession(resourceName, session) {
  const config = getResourceConfig(resourceName);

  if (!config) {
    const error = new Error(`Không hỗ trợ resource UPHARMA: ${resourceName}`);
    error.statusCode = 404;
    throw error;
  }

  const data = [];
  const failedShops = [];

  for (const shop of session.shops) {
    try {
      const responseData = await requestUpharma(config.pathname, {
        ...config.payload(),
        Token: session.token,
        uPharmaID: String(session.user.uPharmaID),
        ShopCode: shop.ShopCode,
      });

      data.push(...extractArray(responseData).map((item) => ({
        ...item,
        __shopCode: shop.ShopCode,
        __shopName: shop.ShopName,
      })));
    } catch (error) {
      failedShops.push(`${shop.ShopCode}: ${error.message}`);
    }
  }

  if (session.shops.length > 0 && failedShops.length === session.shops.length) {
    const error = new Error(`${resourceName}: tất cả nhà thuốc đều lỗi (${failedShops.join(", ")})`);
    error.statusCode = 502;
    throw error;
  }

  return {
    success: true,
    resource: resourceName,
    user: session.user,
    shops: session.shops,
    data,
    failedShops,
    fetchedAt: new Date().toISOString(),
  };
}

async function getUpharmaResource(resourceName) {
  const cached = upharmaResourceCache.get(resourceName);

  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.data, cached: true };
  }

  if (!upharmaResourcePromises.has(resourceName)) {
    const loadPromise = fetchUpharmaResource(resourceName)
      .then((data) => {
        upharmaResourceCache.set(resourceName, {
          data,
          expiresAt: Date.now() + UPHARMA_CACHE_TTL_MS,
        });
        return data;
      })
      .finally(() => {
        upharmaResourcePromises.delete(resourceName);
      });

    upharmaResourcePromises.set(resourceName, loadPromise);
  }

  const data = await upharmaResourcePromises.get(resourceName);
  return { ...data, cached: false };
}

async function handleUpharmaResource(res, resourceName) {
  const data = await getUpharmaResource(resourceName);
  sendJson(res, 200, data);
}

async function handleExternalApi(res) {
  const response = await fetch("https://jsonplaceholder.typicode.com/posts?_limit=5");
  const data = await response.json();

  sendJson(res, 200, {
    message: "External API data loaded",
    data,
  });
}

async function handleSendToN8n(req, res) {
  const payload = await readJsonBody(req);

  const response = await fetch(N8N_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source: "node-backend",
      payload,
    }),
  });

  const responseText = await response.text();

  sendJson(res, response.ok ? 200 : 502, {
    message: response.ok ? "Sent data to n8n webhook" : "n8n webhook returned an error",
    n8nStatus: response.status,
    n8nResponse: responseText,
  });
}

function assertSafeUpharmaPathname(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith("/") || pathname.includes("://")) {
    const error = new Error("pathname API UPHARMA không hợp lệ");
    error.statusCode = 400;
    throw error;
  }
}

async function handleUpharmaProxyLogin(req, res) {
  const payload = await readJsonBody(req);

  if (!payload.UserName || !payload.Password) {
    sendJson(res, 400, {
      RespCode: 400,
      RespText: "Vui lòng nhập UserName và Password",
    });
    return;
  }

  const loginData = await requestUpharma("/User/UserLogin", {
    UserName: payload.UserName,
    Password: payload.Password,
  });

  sendJson(res, 200, loginData);
}

async function handleUpharmaCall(req, res) {
  const payload = await readJsonBody(req);
  const pathname = payload.pathname;
  const requestPayload = payload.payload || {};

  assertSafeUpharmaPathname(pathname);

  const cachedResponse = await getCachedUpharmaRequest(pathname, requestPayload, {
    ttlMs: payload.ttlMs,
  });

  sendJson(res, 200, {
    success: true,
    pathname,
    cached: cachedResponse.cached,
    cacheSource: cachedResponse.cacheSource || null,
    cachedAt: cachedResponse.cachedAt,
    data: cachedResponse.data,
  });
}

async function handleUpharmaResourceProxy(req, res) {
  const payload = await readJsonBody(req);
  const resourceName = String(payload.resourceName || "");
  const token = payload.Token || payload.token;
  const uPharmaID = Number(payload.uPharmaID);
  const shops = Array.isArray(payload.shops) ? payload.shops : [];

  if (!resourceName || !getResourceConfig(resourceName)) {
    sendJson(res, 400, {
      success: false,
      message: "resourceName không hợp lệ",
    });
    return;
  }

  if (!token || !uPharmaID || shops.length === 0) {
    sendJson(res, 400, {
      success: false,
      message: "Thiếu Token, uPharmaID hoặc shops",
    });
    return;
  }

  const filteredShops = shops.filter((shop) => shop?.ShopCode && !EXCLUDED_SHOP_CODES.has(shop.ShopCode));
  const resourceSession = {
    token,
    user: {
      uPharmaID,
      FullName: String(payload.FullName || ""),
      Email: payload.Email,
    },
    shops: filteredShops,
  };
  const cacheKey = makeCacheKey("upharma-resource", {
    resourceName,
    uPharmaID,
    shops: filteredShops.map((shop) => shop.ShopCode),
    config: getResourceConfig(resourceName).payload(),
  });
  const cached = await readDiskCache(cacheKey, Number(payload.ttlMs || UPHARMA_CACHE_TTL_MS));

  if (cached.hit) {
    sendJson(res, 200, {
      ...cached.data,
      cached: true,
      cacheSource: cached.source,
      cachedAt: new Date(cached.savedAt).toISOString(),
    });
    return;
  }

  if (!upharmaResourcePromises.has(cacheKey)) {
    const loadPromise = fetchUpharmaResourceWithSession(resourceName, resourceSession)
      .then(async (data) => {
        const savedAt = await writeDiskCache(cacheKey, data, Number(payload.ttlMs || UPHARMA_CACHE_TTL_MS));

        return {
          ...data,
          cached: false,
          cachedAt: new Date(savedAt).toISOString(),
        };
      })
      .finally(() => {
        upharmaResourcePromises.delete(cacheKey);
      });

    upharmaResourcePromises.set(cacheKey, loadPromise);
  }

  sendJson(res, 200, await upharmaResourcePromises.get(cacheKey));
}

async function handleLogin(req, res) {
  const payload = await readJsonBody(req);

  if (!payload.UserName || !payload.Password) {
    sendJson(res, 400, {
      success: false,
      message: "Vui lòng nhập UserName và Password",
    });
    return;
  }

  const response = await fetch("https://icpc1hn.work/NHATHUOC/User/UserLogin", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: "https://upharma.com.vn",
      Referer: "https://upharma.com.vn/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({
      UserName: payload.UserName,
      Password: payload.Password,
    }),
  });

  const text = await response.text();
  let data = text;

  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  sendJson(res, response.ok ? 200 : response.status, {
    success: response.ok,
    status: response.status,
    data,
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        status: "ok",
        service: "node-api-n8n-backend",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/data") {
      sendJson(res, 200, {
        message: "Backend API is working",
        data: [
          { id: 1, name: "Frontend HTML/CSS/JS" },
          { id: 2, name: "Backend Node.js API" },
          { id: 3, name: "n8n automation webhook" },
        ],
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/external") {
      await handleExternalApi(res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/send-to-n8n") {
      await handleSendToN8n(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/upharma/login") {
      await handleUpharmaProxyLogin(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/upharma/call") {
      await handleUpharmaCall(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/upharma/resource") {
      await handleUpharmaResourceProxy(req, res);
      return;
    }

    const upharmaResourceName = UPHARMA_RESOURCE_ROUTES.get(url.pathname);

    if (req.method === "POST" && upharmaResourceName) {
      await handleUpharmaResource(res, upharmaResourceName);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/login") {
      await handleLogin(req, res);
      return;
    }

    sendJson(res, 404, {
      message: "Route not found",
      path: url.pathname,
    });
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      message: "Internal server error",
      error: error.message,
    });
  }
});

server.listen(PORT, () => {
  console.log(`Backend API running at http://localhost:${PORT}`);
  console.log(`n8n webhook URL: ${N8N_WEBHOOK_URL}`);
});
