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
  const preferredKeys = ["SalesSpeedLst", "Data", "data", "DataLst", "ListData", "InventoryLst", "InventoryList", "Table", "Rows", "ProductLst"];
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
  // Keep the current month for out-of-stock and the three fully completed
  // months for fast/slow sales classification in the same Firebase payload.
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

function getTwoCompletedMonthsWindow(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  return {
    start: formatDateTime(start),
    end: formatDateTime(end),
  };
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
        TimeStart: getTwoCompletedMonthsWindow(now).start,
        TimeEnd: getTwoCompletedMonthsWindow(now).end,
      }),
    },
    customer_new: {
      pathname: "/Buyer/GetCustomerNewLst",
      payload: () => ({
        Month: now.getMonth() + 1,
        Year: now.getFullYear(),
      }),
    },
    dashboard_statistics: {
      pathname: "/CancelProduct/GetStatisticsShop",
      payload: () => ({
        TimeStart: getOneMonthWindow(now).start,
        TimeEnd: getOneMonthWindow(now).end,
      }),
    },
    dashboard_customers: {
      pathname: "/Buyer/GetCustomerNewLst",
      payload: () => ({
        Month: now.getMonth() + 1,
        Year: now.getFullYear(),
      }),
    },
    transfer_process: {
      pathname: "/TransferOrder/GetTransferOrderProcess",
      payload: () => ({}),
    },
    product_off: {
      pathname: "/ProductOff/GetProductOff",
      payload: () => ({}),
    },
    product_follower: {
      pathname: "/Product/GetItemLstWithFollower",
      payload: () => ({
        ProductType: "",
        Search: "",
        NumberRow: 0,
        PageNumber: 0,
      }),
    },
    sales_report: {
      pathname: "/SalesInvoice/GetReportSalesByShop",
      payload: () => {
        const firstDayOfMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
        return {
          TimeStart: `${firstDayOfMonth} 00:00:00`,
          TimeEnd: currentTime,
        };
      },
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
    await db.ref(`users_by_username/${UPHARMA_USERNAME}/login_info`).set({
      ...loginData,
      fetchedAt: new Date().toISOString()
    });
    await db.ref(`users_by_username/${UPHARMA_USERNAME}/allowed_shops`).set(
      shops.map(shop => shop.ShopCode)
    );
    console.log(`Đã push login data và allowed_shops cho ${UPHARMA_USERNAME} lên Firebase RTDB`);
  }

  const allShopsData = {
    inventory: {},
    sales_speed: {},
    transfer_process: {},
    product_off: {},
    product_follower: {},
    statistics_shop: {},
    dashboard_statistics: {},
    dashboard_customers: {}
  };

  const resources = [
    'inventory',
    'invoices',
    'messages',
    'employees',
    'orders',
    'sales_speed',
    'statistics_shop',
    'customer_new',
    'dashboard_statistics',
    'dashboard_customers',
    'transfer_process',
    'product_off',
    'product_follower',
    'sales_report',
  ];
  
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
        const mappedArray = arrayData.map((item) => ({
          ...item,
          __shopCode: shop.ShopCode,
          __shopName: shop.ShopName,
        }));
        data.push(...mappedArray);

        if (allShopsData[resourceName]) {
          allShopsData[resourceName][shop.ShopCode] = mappedArray;
        }

        if (resourceName === 'statistics_shop') {
          allShopsData.statistics_shop_raw = allShopsData.statistics_shop_raw || {};
          allShopsData.statistics_shop_raw[shop.ShopCode] = responseData;
        }

        if (db) {
          const payloadData = (resourceName === 'dashboard_statistics' || resourceName === 'dashboard_customers') ? responseData : mappedArray;
          await db.ref(`shops/${shop.ShopCode}/upharma_data/${resourceName}`).set({
            success: true,
            resource: resourceName,
            shop: {
              ShopCode: shop.ShopCode,
              ShopName: shop.ShopName,
            },
            data: payloadData,
            fetchedAt: new Date().toISOString(),
          });
          console.log(`Đã push ${resourceName} của shop ${shop.ShopCode} lên Firebase RTDB (${mappedArray.length} records)`);
        }
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

    // Restore JSON output for frontend compatibility
    fs.writeFileSync(path.join(DATA_DIR, `${resourceName}.json`), JSON.stringify(resourceData, null, 2));
    console.log(`Đã lưu ${resourceName}.json`);
  }

  await calculateAndUploadSummaries(shops, allShopsData, db);
  
  console.log("Hoàn thành fetch data!");
  if (db) {
    process.exit(0);
  }
}

run().catch(console.error);

function pick(obj, keys) {
  if (!obj) return "";
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) {
      return obj[key];
    }
  }
  return "";
}

function parseDateTimeValue(value) {
  if (!value) return null;
  const text = String(value).trim();
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  const viMatch = text.match(/^(\d{2})[/-](\d{2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);

  if (isoMatch) {
    return new Date(
      Number(isoMatch[1]),
      Number(isoMatch[2]) - 1,
      Number(isoMatch[3]),
      Number(isoMatch[4] || 0),
      Number(isoMatch[5] || 0),
      Number(isoMatch[6] || 0)
    ).getTime();
  }
  if (viMatch) {
    return new Date(
      Number(viMatch[3]),
      Number(viMatch[2]) - 1,
      Number(viMatch[1]),
      Number(viMatch[4] || 0),
      Number(viMatch[5] || 0),
      Number(viMatch[6] || 0)
    ).getTime();
  }
  const parsed = new Date(text).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function toNumber(value) {
  if (typeof value === "number") return value;
  const normalizedValue = String(value ?? "").replace(",", ".").trim();
  const num = Number(normalizedValue);
  return Number.isNaN(num) ? 0 : num;
}

function precalculateSalesSpeed(rows, shop) {
  const now = new Date();
  const completedMonthKeys = [];
  const completedMonthSessions = [];
  for (let offset = 2; offset >= 1; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    completedMonthKeys.push(key);
    completedMonthSessions.push({
      key,
      sessionText: `${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`,
      label: `${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`,
      date
    });
  }

  const groupedRows = new Map();
  for (const row of rows) {
    const productCode = String(pick(row, ["ProductID", "ProductCode", "Product_ID", "MaSP", "MaSanPham", "ItemCode", "Code"])).trim();
    if (!productCode || productCode.toUpperCase().startsWith("Y")) {
      continue;
    }
    if (!groupedRows.has(productCode)) {
      groupedRows.set(productCode, []);
    }
    groupedRows.get(productCode).push(row);
  }

  const stableRows = [];
  const slowRows = [];

  for (const [productCode, productRows] of groupedRows.entries()) {
    const monthMap = new Map();
    for (const m of completedMonthSessions) {
      monthMap.set(m.key, {
        key: m.key,
        sessionText: m.sessionText,
        label: m.label,
        quantity: 0,
        date: m.date
      });
    }

    for (const row of productRows) {
      const parsedTime = parseDateTimeValue(pick(row, ["TimeBegin", "TimeStart", "BeginTime", "StartTime", "Date", "Ngay"]));
      let date = null;
      if (parsedTime !== null) {
        const d = new Date(parsedTime);
        date = new Date(d.getFullYear(), d.getMonth(), 1);
      } else {
        const session = String(pick(row, ["Session", "Ky", "Thang"]));
        const match = session.match(/(\d{1,2}).*?(\d{4})/);
        if (match) {
          date = new Date(Number(match[2]), Number(match[1]) - 1, 1);
        }
      }

      if (!date) continue;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      if (monthMap.has(key)) {
        const current = monthMap.get(key);
        const qty = toNumber(pick(row, ["Quantity", "Qty", "SL", "SoLuong", "QuantitySale", "TotalQuantity", "QtySale"]));
        current.quantity += qty;
      }
    }

    const monthList = completedMonthKeys.map(key => monthMap.get(key));

    const totalQuantity = monthList.reduce((sum, m) => sum + m.quantity, 0);
    const maxMonthQuantity = Math.max(...monthList.map(m => m.quantity));

    const firstRow = productRows[0];
    const productName = String(pick(firstRow, ["ProductName", "Product_Name", "ProductFullName", "TenSP", "TenSanPham", "Name", "ItemName"])).trim();
    const unit = String(pick(firstRow, ["UnitOfMeasure", "UnitName", "Unit", "DonVi", "DonViTinh", "DVT"])) || "--";
    const quantityExist = pick(firstRow, ["QuantityExist", "ExistQuantity", "TonKho", "InventoryQuantity", "RemainQty"]);
    const quantityExistText = quantityExist === "" ? "--" : String(quantityExist);

    const isStable = monthList.every(m => m.quantity >= 4);
    if (isStable) {
      stableRows.push({
        rowKey: [shop.ShopCode, productCode].join("|"),
        shopCode: shop.ShopCode,
        productCode,
        productName,
        unit,
        quantityExistText,
        stableMonths: monthList.map(m => ({
          key: m.key,
          sessionText: m.sessionText,
          label: m.label,
          quantity: m.quantity,
          quantityText: String(m.quantity),
          date: m.date.toISOString()
        })),
        totalQuantity,
        maxMonthQuantity,
        expanded: false
      });
    }

    const hasAtLeastOneMonthBelowFour = monthList.some(m => m.quantity < 4);
    const hasAtLeastOneSale = monthList.some(m => m.quantity > 0);
    if (hasAtLeastOneMonthBelowFour && hasAtLeastOneSale) {
      slowRows.push({
        rowKey: [shop.ShopCode, productCode].join("|"),
        shopCode: shop.ShopCode,
        productCode,
        productName,
        unit,
        quantityExistText,
        slowMonths: monthList.map(m => ({
          key: m.key,
          sessionText: m.sessionText,
          label: m.label,
          quantity: m.quantity,
          quantityText: String(m.quantity),
          date: m.date.toISOString()
        })),
        totalQuantity,
        maxMonthQuantity,
        expanded: false
      });
    }
  }

  return { stableRows, slowRows };
}

function precalculateKeyProducts(rows, shop, rawData) {
  const productMap = new Map();
  for (const row of rows) {
    const sc = String(row["__shopCode"] || row["ShopCode"] || "");
    if (sc && sc !== shop.ShopCode) continue;
    const productCode = String(pick(row, ["ProductID", "ProductCode", "Product_ID", "MaSP", "MaSanPham", "ItemCode", "Code"])).trim();
    if (!productCode || productCode.toUpperCase().startsWith("Y")) continue;
    const productName = String(pick(row, ["ProductName", "Product_Name", "ProductFullName", "TenSP", "TenSanPham", "Name", "ItemName"])).trim();
    const amount = toNumber(pick(row, ["Amount", "TotalAmount", "ThanhTien", "AmountIncludingVAT"]));
    if (amount <= 0) continue;

    if (!productMap.has(productCode)) {
      productMap.set(productCode, { productCode, productName, amount: 0 });
    }
    productMap.get(productCode).amount += amount;
  }

  const sorted = Array.from(productMap.values()).sort((a, b) => b.amount - a.amount);
  
  let totalRevenue = 0;
  if (rawData && rawData.PaymentMethodInfo) {
    const { Cash, Card, VNPay, CK } = rawData.PaymentMethodInfo;
    totalRevenue = Number(Cash || 0) + Number(Card || 0) + Number(VNPay || 0) + Number(CK || 0);
  }
  
  if (totalRevenue <= 0) {
    totalRevenue = sorted.reduce((sum, p) => sum + p.amount, 0);
  }
  
  if (totalRevenue <= 0) return [];

  let cumulative = 0;
  const keyRows = [];
  for (const product of sorted) {
    cumulative += product.amount;
    keyRows.push({
      rowKey: [shop.ShopCode, product.productCode].join("|"),
      shopCode: shop.ShopCode,
      productCode: product.productCode,
      productName: product.productName,
      amount: product.amount,
      amountText: String(product.amount),
      percentOfTotal: Math.round((product.amount / totalRevenue) * 10000) / 100,
      cumulativePercent: Math.round((cumulative / totalRevenue) * 10000) / 100,
      expanded: false
    });
  }
  return keyRows;
}

function precalculateOutOfStock(salesSpeedRows, inventoryRows, transferProcessRows, productOffRows, productFollowerRows, shop) {
  const inventoryAvailability = new Set();
  for (const row of inventoryRows || []) {
    const quantity = pick(row, ["QuantityExist", "ExistQuantity", "Quantity", "Qty", "SL", "SoLuong", "TonKho", "InventoryQuantity", "StockQty", "RemainQty"]);
    if (toNumber(quantity) <= 0) {
      continue;
    }
    const sc = String(row["__shopCode"] || row["ShopCode"] || "");
    const productName = String(pick(row, ["ProductName", "Product_Name", "ProductFullName", "Product_Name_Full", "TenSP", "TenSanPham", "Name", "ItemName"]));
    const key = [sc, productName].join("|").toLowerCase();
    if (sc && key) {
      inventoryAvailability.add(key);
    }
  }

  const plannedProductIds = new Set();
  for (const row of transferProcessRows || []) {
    const dateExceed = toNumber(pick(row, ["DateExceed", "Date_Exceed", "SoNgayVuot", "DaysExceeded"]));
    if (!Number.isFinite(dateExceed) || dateExceed > 60) {
      continue;
    }
    const productId = String(pick(row, ["ProductID", "ProductCode", "Product_ID", "MaSP", "MaSanPham", "ItemCode", "Code"])).trim();
    if (productId) {
      plannedProductIds.add(productId);
    }
  }

  const stoppedProductIds = new Set();
  for (const row of productOffRows || []) {
    const productId = String(pick(row, ["ProductID", "ProductCode", "Product_ID", "MaSP", "MaSanPham", "ItemCode", "Code"])).trim();
    if (productId) {
      stoppedProductIds.add(productId);
    }
  }
  for (const row of productFollowerRows || []) {
    const registerType = String(pick(row, ["RegisterType", "Register_Type", "LoaiDangKy", "LoaiDK"])).trim().toLowerCase();
    if (registerType !== "hàng dừng" && registerType !== "hang dung") {
      continue;
    }
    const productId = String(pick(row, ["ProductID", "ProductCode", "Product_ID", "MaSP", "MaSanPham", "ItemCode", "Code"])).trim();
    if (productId) {
      stoppedProductIds.add(productId);
    }
  }

  const outOfStockRows = [];
  const processedRows = [...(salesSpeedRows || [])];
  
  processedRows.sort((first, second) => {
    const firstProduct = String(pick(first, ["ProductName", "Product_Name", "ProductFullName", "TenSP", "TenSanPham", "Name", "ItemName"])).trim();
    const secondProduct = String(pick(second, ["ProductName", "Product_Name", "ProductFullName", "TenSP", "TenSanPham", "Name", "ItemName"])).trim();
    return firstProduct.localeCompare(secondProduct, "vi");
  });

  let index = 0;
  for (const row of processedRows) {
    const productCode = String(pick(row, ["ProductID", "ProductCode", "Product_ID", "MaSP", "MaSanPham", "ItemCode", "Code"])).trim();
    if (!productCode || productCode.toUpperCase().startsWith("Y")) {
      continue;
    }

    if (stoppedProductIds.has(productCode)) {
      continue;
    }

    const productName = String(pick(row, ["ProductName", "Product_Name", "ProductFullName", "TenSP", "TenSanPham", "Name", "ItemName"])).trim();
    const sc = shop.ShopCode;
    const invKey = [sc, productName].join("|").toLowerCase();
    if (inventoryAvailability.has(invKey)) {
      continue;
    }

    const isZeroStock = toNumber(pick(row, ["QuantityExist", "ExistQuantity", "TonKho", "InventoryQuantity", "RemainQty"])) <= 0;
    if (!isZeroStock) {
      continue;
    }

    const status = plannedProductIds.has(productCode) ? "Đã dự trù" : "Rỗng";
    const quantity = pick(row, ["QuantityExist", "ExistQuantity", "TonKho", "InventoryQuantity", "RemainQty"]);
    const quantityText = quantity === "" ? "0" : String(quantity);
    const unit = String(pick(row, ["UnitOfMeasure", "UnitName", "Unit", "DonVi", "DonViTinh", "DVT"])) || "--";
    
    const timeBegin = String(pick(row, ["TimeBegin", "TimeStart", "BeginTime", "StartTime", "Date", "Ngay"]));
    let shortageMonth = "";
    if (timeBegin) {
      const match = timeBegin.match(/^(\d{4})-(\d{2})/);
      if (match) {
        shortageMonth = `${match[1]}-${match[2]}`;
      } else {
        const viMatch = timeBegin.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
        if (viMatch) {
          shortageMonth = `${viMatch[3]}-${viMatch[2]}`;
        }
      }
    }
    if (!shortageMonth) {
      const session = String(pick(row, ["Session", "Ky", "Thang"]));
      const match = session.match(/(\d{1,2}).*?(\d{4})/);
      if (match) {
        shortageMonth = `${match[2]}-${String(match[1]).padStart(2, "0")}`;
      }
    }

    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    if (shortageMonth !== currentMonthStr) {
      continue;
    }

    outOfStockRows.push({
      rowKey: [sc, productCode, String(index)].join("|"),
      shopCode: sc,
      productName,
      productCode,
      status,
      quantityText,
      shortageMonth,
      zeroStock: true,
      unit,
      searchText: [productName, productCode].join(" ").toLowerCase(),
      expanded: false
    });
    index++;
  }

  return outOfStockRows;
}

async function calculateAndUploadSummaries(shops, allShopsData, db) {
  console.log("\n[precalculation] Bắt đầu tính toán Hàng đã hết, Hàng lặp tốt, Hàng lặp chậm và Shops Summary...");
  
  const summaryMap = {};
  
  for (const shop of shops) {
    const sc = shop.ShopCode;
    summaryMap[sc] = {
      outOfStockCount: 0,
      stableCount: 0,
      slowCount: 0,
      keyCount: 0
    };

    const salesSpeedRows = allShopsData.sales_speed[sc] || [];
    const inventoryRows = allShopsData.inventory[sc] || [];
    const transferProcessRows = allShopsData.transfer_process[sc] || [];
    const productOffRows = allShopsData.product_off[sc] || [];
    const productFollowerRows = allShopsData.product_follower[sc] || [];

    const { stableRows, slowRows } = precalculateSalesSpeed(salesSpeedRows, shop);
    
    const outStockRows = precalculateOutOfStock(
      salesSpeedRows,
      inventoryRows,
      transferProcessRows,
      productOffRows,
      productFollowerRows,
      shop
    );

    const statisticsShopRows = allShopsData.statistics_shop[sc] || [];
    const statisticsShopRaw = (allShopsData.statistics_shop_raw && allShopsData.statistics_shop_raw[sc]) || null;
    const keyProductRows = precalculateKeyProducts(statisticsShopRows, shop, statisticsShopRaw);

    summaryMap[sc].stableCount = stableRows.length;
    summaryMap[sc].slowCount = slowRows.length;
    summaryMap[sc].outOfStockCount = outStockRows.length;
    summaryMap[sc].keyCount = keyProductRows.length;

    if (db) {
      try {
        await db.ref(`shops/${sc}/upharma_data/stable_consumption_calculated`).set({
          success: true,
          resource: 'stable_consumption_calculated',
          shop: { ShopCode: sc, ShopName: shop.ShopName },
          data: stableRows,
          fetchedAt: new Date().toISOString(),
        });

        await db.ref(`shops/${sc}/upharma_data/slow_selling_calculated`).set({
          success: true,
          resource: 'slow_selling_calculated',
          shop: { ShopCode: sc, ShopName: shop.ShopName },
          data: slowRows,
          fetchedAt: new Date().toISOString(),
        });

        await db.ref(`shops/${sc}/upharma_data/out_of_stock_calculated`).set({
          success: true,
          resource: 'out_of_stock_calculated',
          shop: { ShopCode: sc, ShopName: shop.ShopName },
          data: outStockRows,
          fetchedAt: new Date().toISOString(),
        });

        await db.ref(`shops/${sc}/upharma_data/key_products_calculated`).set({
          success: true,
          resource: 'key_products_calculated',
          shop: { ShopCode: sc, ShopName: shop.ShopName },
          data: keyProductRows,
          fetchedAt: new Date().toISOString(),
        });
        
        console.log(`[precalculation] DONE ${sc}: Hàng đã hết (${outStockRows.length}), Lặp tốt (${stableRows.length}), Lặp chậm (${slowRows.length}), Hàng key (${keyProductRows.length})`);
      } catch (err) {
        console.warn(`[precalculation] Lỗi khi upload kết quả tính toán cho shop ${sc}:`, err);
      }
    }
  }

  if (db) {
    try {
      await db.ref(`shops_summary`).set({
        success: true,
        resource: 'shops_summary',
        data: summaryMap,
        fetchedAt: new Date().toISOString()
      });
      console.log("[precalculation] DONE upload shops_summary lên Firebase RTDB!");
    } catch (err) {
      console.warn("[precalculation] Lỗi khi upload shops_summary:", err);
    }
  }
}
