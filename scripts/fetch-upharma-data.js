const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

let db = null;
if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    const app = initializeApp({
      credential: cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
    });
    db = getDatabase(app);
    console.log("Firebase Admin initialized (Kết nối Firebase thành công)");
  } catch (err) {
    console.error("Firebase init error (Kết nối Firebase thất bại):", err.message);
  }
} else {
  console.log("Không tìm thấy cấu hình FIREBASE_SERVICE_ACCOUNT_KEY (Bỏ qua kết nối Firebase)");
}

const UPHARMA_API_BASE_URL = process.env.UPHARMA_API_BASE_URL || "https://icpc1hn.work/NHATHUOC";
const UPHARMA_USERNAME = process.env.UPHARMA_USERNAME;
const UPHARMA_PASSWORD = process.env.UPHARMA_PASSWORD;
const EXCLUDED_SHOP_CODES = new Set(
  (process.env.UPHARMA_EXCLUDED_SHOPS || "SHOP0040")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

const DATA_DIR = path.join(__dirname, '..', 'src', 'assets', 'data');

async function requestUpharma(pathname, payload) {
  const response = await fetch(`${UPHARMA_API_BASE_URL}${pathname}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: "https://upharma.com.vn",
      Referer: "https://upharma.com.vn/",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
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
    throw new Error(`UPHARMA ${pathname} trả về HTTP ${response.status}`);
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

function getResourceConfig(resourceName, now = new Date()) {
  const currentTime = formatDateTime(now);
  const today = currentTime.slice(0, 10);
  const twoMonthsAgo = new Date(now);
  twoMonthsAgo.setUTCMonth(twoMonthsAgo.getUTCMonth() - 2);

  const nineMonthsAgo = new Date(now);
  nineMonthsAgo.setUTCMonth(nineMonthsAgo.getUTCMonth() - 9);

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
    sales_speed: {
      pathname: "/SalesInvoice/GetReportSalesSpeed",
      payload: () => ({
        TimeStart: formatDateTime(nineMonthsAgo),
        TimeEnd: currentTime,
        ProductID: "",
        GetType: "Week",
        ViewCity: 0,
      }),
    },
  };
  return configs[resourceName];
}

async function run() {
  if (!UPHARMA_USERNAME || !UPHARMA_PASSWORD) {
    console.error("Thiếu UPHARMA_USERNAME hoặc UPHARMA_PASSWORD");
    process.exit(1);
  }

  console.log("Đăng nhập...");
  const loginData = await requestUpharma("/User/UserLogin", {
    UserName: UPHARMA_USERNAME,
    Password: UPHARMA_PASSWORD,
  });

  if (loginData.RespCode !== 0 || !loginData.Token) {
    console.error("Đăng nhập thất bại:", loginData.RespText);
    process.exit(1);
  }

  const allShops = loginData.UserInfo?.ShopLst || [];
  const shops = allShops.filter((shop) => !EXCLUDED_SHOP_CODES.has(shop.ShopCode));
  
  if (shops.length === 0) {
    console.error("Không có nhà thuốc hợp lệ sau khi filter.");
    process.exit(1);
  }

  // Rewrite ShopLst to only include valid shops
  loginData.UserInfo.ShopLst = shops;

  // Restore JSON output for frontend compatibility
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(path.join(DATA_DIR, 'login.json'), JSON.stringify(loginData, null, 2));
  console.log("Đã lưu login.json");

  if (db) {
    await db.ref('sync_logs/login').set({
      ...loginData,
      fetchedAt: new Date().toISOString()
    });
    console.log("Đã push login data lên Firebase RTDB");
  }

  const resources = ['inventory', 'invoices', 'messages', 'employees', 'orders', 'sales_speed'];
  
  for (const resourceName of resources) {
    console.log(`Đang lấy data cho ${resourceName}...`);
    const config = getResourceConfig(resourceName);
    const data = [];
    const failedShops = [];

    for (const shop of shops) {
      try {
        const responseData = await requestUpharma(config.pathname, {
          ...config.payload(),
          Token: loginData.Token,
          uPharmaID: String(loginData.UserInfo.uPharmaID),
          ShopCode: shop.ShopCode,
          ShopLst: shop.ShopCode, // Some APIs like GetReportSalesSpeed use ShopLst
        });

        const arrayData = extractArray(responseData);
        data.push(...arrayData.map((item) => ({
          ...item,
          __shopCode: shop.ShopCode,
          __shopName: shop.ShopName,
        })));
      } catch (error) {
        failedShops.push(`${shop.ShopCode}: ${error.message}`);
      }
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
      data,
      failedShops,
      fetchedAt: new Date().toISOString(),
    };

    if (db) {
      await db.ref(`upharma_data/${resourceName}`).set(resourceData);
      console.log(`Đã push ${resourceName} lên Firebase RTDB (${data.length} records)`);
    }

    // Restore JSON output for frontend compatibility
    fs.writeFileSync(path.join(DATA_DIR, `${resourceName}.json`), JSON.stringify(resourceData, null, 2));
    console.log(`Đã lưu ${resourceName}.json`);
  }
  
  console.log("Hoàn thành fetch data!");
  if (db) {
    process.exit(0);
  }
}

run().catch(console.error);
