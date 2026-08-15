const fs = require('fs');
const path = require('path');
const { initializeApp, cert, getApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

let db = null;

function initFirebase() {
  if (db) return db;

  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      // Check if app is already initialized to avoid duplicate app errors in Node.js
      let app;
      try {
        app = getApp();
      } catch {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
        app = initializeApp({
          credential: cert(serviceAccount),
          databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
        });
      }
      db = getDatabase(app);
      console.log("[Sync Service] Firebase Admin SDK initialized successfully");
    } catch (err) {
      console.error("[Sync Service] Firebase init error:", err.message);
    }
  } else {
    console.log("[Sync Service] FIREBASE_SERVICE_ACCOUNT_KEY not defined in .env. Realtime Database updates skipped.");
  }
  return db;
}

const UPHARMA_API_BASE_URL = process.env.UPHARMA_API_BASE_URL || "https://icpc1hn.work/NHATHUOC";
const EXCLUDED_SHOP_CODES = new Set(
  (process.env.UPHARMA_EXCLUDED_SHOPS || "SHOP0040")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

// We will write to both source and build output directories if they exist
const DATA_DIRS = [
  path.join(__dirname, '..', 'src', 'assets', 'data'),
  path.join(__dirname, '..', 'dist', 'upharma', 'browser', 'assets', 'data')
];

const REQUEST_TIMEOUT_MS = 120000;
const SHOP_CONCURRENCY = 3;

let isSyncing = false;

async function requestUpharma(pathname, payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`Timeout sau ${REQUEST_TIMEOUT_MS}ms`)), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${UPHARMA_API_BASE_URL}${pathname}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: "https://upharma.com.vn",
        Referer: "https://upharma.com.vn/",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`UPHARMA ${pathname} returned HTTP ${response.status}`);
  }
  return data;
}

function extractArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const preferredKeys = ["SalesSpeedLst", "Data", "data", "DataLst", "ListData", "InventoryLst", "InventoryList", "Table", "Rows"];
  for (const key of preferredKeys) {
    if (Array.isArray(data[key])) return data[key];
  }
  const queue = Object.values(data).filter((value) => value && typeof value === "object");
  while (queue.length > 0) {
    const value = queue.shift();
    if (Array.isArray(value)) return value;
    queue.push(...Object.values(value).filter((item) => item && typeof item === "object"));
  }
  return [];
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

function formatDateOnly(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getSalesSpeedWindow(now = new Date()) {
  const current = new Date(now);
  const start = new Date(now);
  start.setMonth(start.getMonth() - 3, 1);
  start.setHours(0, 0, 0, 0);
  current.setHours(23, 59, 59, 999);
  return {
    start: formatDateOnly(start),
    end: formatDateOnly(current),
  };
}

function getOneMonthWindow(now = new Date()) {
  const end = new Date(now);
  const start = new Date(now);
  start.setMonth(start.getMonth() - 1);
  return {
    start: formatDateTime(start),
    end: formatDateTime(end),
  };
}

function getResourceConfig(resourceName, now = new Date()) {
  const currentTime = formatDateTime(now);
  const today = currentTime.slice(0, 10);

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
      payload: () => ({ TimeStart: `${today} 00:00:00`, TimeEnd: currentTime }),
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
    sales_speed: {
      pathname: "/SalesInvoice/GetReportSalesSpeed",
      payload: () => ({
        TimeStart: `${getSalesSpeedWindow(now).start} 00:00:00`,
        TimeEnd: `${getSalesSpeedWindow(now).end} 23:59:59`,
        ProductID: "",
        GetType: "month",
        ViewCity: 0,
      }),
    },
    statistics_shop: {
      pathname: "/CancelProduct/GetStatisticsShop",
      payload: () => ({
        TimeStart: getOneMonthWindow(now).start,
        TimeEnd: getOneMonthWindow(now).end,
      }),
    },
    customer_new: {
      pathname: "/Buyer/GetCustomerNewLst",
      payload: () => ({
        Month: now.getMonth() + 1,
        Year: now.getFullYear(),
      }),
    },
  };
  return configs[resourceName];
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let index = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const currentIndex = index;
      index += 1;
      if (currentIndex >= items.length) break;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

function sanitizePIIDeep(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map(sanitizePIIDeep);
  }
  if (typeof value === "object") {
    const copy = {};
    for (const [k, v] of Object.entries(value)) {
      const lowerKey = k.toLowerCase();
      if (typeof v === "string") {
        if (lowerKey.includes("phone") || lowerKey.includes("mobile") || lowerKey === "sdt" || lowerKey === "tel") {
          copy[k] = v.trim().replace(/^(\+?\d{2,4})\d+(\d{3})$/, "$1***$2");
        } else if (lowerKey.includes("email") || lowerKey === "mail") {
          copy[k] = v.split(';').map(email => email.trim().replace(/^([^@]{2})[^@]+(@.+)$/, "$1***$2")).join(';');
        } else if (lowerKey.includes("customername") || lowerKey.includes("buyername") || lowerKey.includes("fullname") || lowerKey.includes("employeename") || lowerKey.includes("tenkhachhang")) {
          const name = v.trim();
          if (name.length > 2) {
            copy[k] = name[0] + "***" + name[name.length - 1];
          } else {
            copy[k] = "***";
          }
        } else if (lowerKey.includes("address") || lowerKey.includes("diachi")) {
          copy[k] = "Anonymized Address";
        } else {
          copy[k] = sanitizePIIDeep(v);
        }
      } else {
        copy[k] = sanitizePIIDeep(v);
      }
    }
    return copy;
  }
  return value;
}

function writeJsonToDataDirs(filename, data) {
  DATA_DIRS.forEach(dir => {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2));
    } catch (err) {
      // Ignore if dir is not writable/writable permissions issue in some envs
    }
  });
}

async function syncData() {
  if (isSyncing) {
    console.log("[Sync Service] Sync is already running. Skipping...");
    return;
  }

  const username = process.env.UPHARMA_USERNAME;
  const password = process.env.UPHARMA_PASSWORD;

  if (!username || !password) {
    console.warn("[Sync Service] Skipping sync. Missing UPHARMA_USERNAME or UPHARMA_PASSWORD in backend/.env");
    return;
  }

  isSyncing = true;
  console.log(`[Sync Service] Starting background sync process at ${new Date().toISOString()}`);

  try {
    initFirebase();

    console.log("[Sync Service] Authenticating with Upharma API...");
    const loginData = await requestUpharma("/User/UserLogin", {
      UserName: username,
      Password: password,
    });

    if (loginData.RespCode !== 0 || !loginData.Token) {
      throw new Error(loginData.RespText || "Upharma authentication failed");
    }

    const allShops = loginData.UserInfo?.ShopLst || [];
    const shops = allShops.filter((shop) => !EXCLUDED_SHOP_CODES.has(shop.ShopCode));
    const syncStartedAt = new Date().toISOString();

    if (shops.length === 0) {
      throw new Error("No valid shops found after filtering.");
    }

    // Rewrite ShopLst in session
    loginData.UserInfo.ShopLst = shops;

    // Write sanitized login cache locally
    const sanitizedLogin = sanitizePIIDeep(loginData);
    writeJsonToDataDirs('login.json', sanitizedLogin);

    // Push login info to Firebase (real data, secured by rules)
    if (db) {
      await db.ref(`users_by_username/${username}/login_info`).set({
        ...loginData,
        fetchedAt: syncStartedAt
      });
      const allowedShopsMap = {};
      shops.forEach(shop => {
        allowedShopsMap[shop.ShopCode] = true;
      });
      await db.ref(`users_by_username/${username}/allowed_shops`).set(allowedShopsMap);
      console.log(`[Sync Service] Pushed login_info and allowed_shops map for ${username} to Firebase RTDB`);
    }

    const resources = ['inventory', 'invoices', 'messages', 'employees', 'orders', 'sales_speed', 'statistics_shop', 'customer_new'];

    for (const resourceName of resources) {
      console.log(`[Sync Service] Fetching resource: ${resourceName} for ${shops.length} shops...`);
      const config = getResourceConfig(resourceName);
      const dataList = [];
      const failedShops = [];

      const shopResults = await mapWithConcurrency(shops, SHOP_CONCURRENCY, async (shop) => {
        try {
          const responseData = await requestUpharma(config.pathname, {
            ...config.payload(),
            Token: loginData.Token,
            uPharmaID: String(loginData.UserInfo.uPharmaID),
            ShopCode: shop.ShopCode,
            ShopLst: shop.ShopCode,
          });

          const arrayData = extractArray(responseData);
          const mappedArray = arrayData.map((item) => ({
            ...item,
            __shopCode: shop.ShopCode,
            __shopName: shop.ShopName,
          }));

          // Push to Firebase RTDB (secured node)
          if (db) {
            await db.ref(`shops/${shop.ShopCode}/upharma_data/${resourceName}`).set({
              success: true,
              resource: resourceName,
              shop: {
                ShopCode: shop.ShopCode,
                ShopName: shop.ShopName,
              },
              data: mappedArray,
              fetchedAt: new Date().toISOString(),
            });
          }

          return { shop, data: mappedArray };
        } catch (err) {
          failedShops.push(`${shop.ShopCode}: ${err.message}`);
          return { shop, data: [] };
        }
      });

      for (const res of shopResults) {
        dataList.push(...res.data);
      }

      const resourceData = {
        success: true,
        resource: resourceName,
        user: {
          uPharmaID: loginData.UserInfo.uPharmaID,
          FullName: loginData.UserInfo.FullName,
          Email: loginData.UserInfo.Email,
        },
        shops: shops,
        data: dataList,
        failedShops,
        syncedAt: syncStartedAt,
        fetchedAt: new Date().toISOString(),
      };

      // Write sanitized JSON locally
      const sanitizedResource = sanitizePIIDeep(resourceData);
      writeJsonToDataDirs(`${resourceName}.json`, sanitizedResource);
    }

    console.log("[Sync Service] Background sync completed successfully.");
  } catch (err) {
    console.error("[Sync Service] Background sync failed:", err.message);
  } finally {
    isSyncing = false;
  }
}

let syncIntervalId = null;

function startAutoSync(intervalMs = 15 * 60 * 1000) {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
  }

  // Run immediate sync on start
  void syncData();

  // Schedule recurring syncs
  syncIntervalId = setInterval(() => {
    void syncData();
  }, intervalMs);

  console.log(`[Sync Service] Scheduled automatic background sync every ${Math.round(intervalMs / 1000 / 60)} minutes.`);
}

function stopAutoSync() {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
    console.log("[Sync Service] Automatic background sync stopped.");
  }
}

module.exports = {
  syncData,
  startAutoSync,
  stopAutoSync
};
