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
    console.log("[sync-catalog] Firebase Admin initialized (Kết nối Firebase thành công)");
  } catch (err) {
    console.error("[sync-catalog] Firebase init error:", err.message);
  }
} else {
  console.log("[sync-catalog] Không tìm thấy FIREBASE_SERVICE_ACCOUNT_KEY (Bỏ qua kết nối Firebase)");
}

const UPHARMA_API_BASE_URL = process.env.UPHARMA_API_BASE_URL || "https://icpc1hn.work/NHATHUOC";
const UPHARMA_USERNAME = process.env.UPHARMA_USERNAME;
const UPHARMA_PASSWORD = process.env.UPHARMA_PASSWORD;
const DATA_DIR = path.join(__dirname, '..', 'src', 'assets', 'data');
const REQUEST_TIMEOUT_MS = Number(process.env.UPHARMA_REQUEST_TIMEOUT_MS || 120000);
const FIREBASE_WRITE_TIMEOUT_MS = Number(process.env.FIREBASE_WRITE_TIMEOUT_MS || 120000);

async function withTimeout(promise, timeoutMs, operation) {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Timeout sau ${timeoutMs}ms khi ${operation}`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function requestUpharma(pathname, payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${UPHARMA_API_BASE_URL}${pathname}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: "https://upharma.com.vn",
        Referer: "https://upharma.com.vn/",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} khi gọi ${pathname}`);
    }

    return await response.json();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Timeout sau ${REQUEST_TIMEOUT_MS}ms khi gọi ${pathname}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function upharmaLogin() {
  if (!UPHARMA_USERNAME || !UPHARMA_PASSWORD) {
    throw new Error("Thiếu UPHARMA_USERNAME hoặc UPHARMA_PASSWORD");
  }
  console.log("[sync-catalog] Đang đăng nhập Upharma...");
  const res = await requestUpharma("/User/UserLogin", {
    UserName: UPHARMA_USERNAME,
    Password: UPHARMA_PASSWORD,
  });
  if (!res || !res.Token) {
    throw new Error(`Đăng nhập Upharma thất bại: ${res?.RespText || "Không nhận được Token"}`);
  }
  return res;
}

function extractArray(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.ItemLst)) return res.ItemLst;
  if (Array.isArray(res.ProductLst)) return res.ProductLst;
  if (Array.isArray(res.Data)) return res.Data;
  if (Array.isArray(res.data)) return res.data;
  if (Array.isArray(res.DataLst)) return res.DataLst;
  for (const key of Object.keys(res)) {
    if (Array.isArray(res[key])) return res[key];
  }
  return [];
}

function isKmProduct(code, name) {
  const c = String(code || "").toUpperCase();
  const n = String(name || "").toUpperCase();
  if (c.startsWith("KM") || n.startsWith("KM")) return true;
  if (/\bKM\b/.test(c) || /\bKM\b/.test(n)) return true;
  return false;
}

function isOffProduct(code, name) {
  const n = String(name || "").toUpperCase();
  if (n.includes("HÀNG DỪNG") || n.includes("NGỪNG KINH DOANH") || n.includes("HANG DUNG") || n.includes("NGUNG KINH DOANH")) {
    return true;
  }
  return false;
}

async function run() {
  console.log("=== CRONJOB: ĐỒNG BỘ PRODUCT_CATALOG VÀO FIREBASE RTDB ===");
  const startTime = Date.now();

  if (!db) {
    throw new Error("Firebase chưa được khởi tạo; kiểm tra FIREBASE_SERVICE_ACCOUNT_KEY và database URL.");
  }

  const loginData = await upharmaLogin();
  console.log("[sync-catalog] Đăng nhập thành công, uPharmaID:", loginData.UserInfo?.uPharmaID);

  console.log("[sync-catalog] Đang tải GetItemLstWithFollower từ Upharma API...");
  const res = await requestUpharma("/Product/GetItemLstWithFollower", {
    NumberRow: 0,
    PageNumber: 0,
    ProductType: "",
    Search: "",
    Token: loginData.Token,
    uPharmaID: String(loginData.UserInfo?.uPharmaID || ""),
  });

  const rows = extractArray(res);
  console.log(`[sync-catalog] Tải về ${rows.length} mục sản phẩm từ API.`);

  const seen = new Set();
  const items = [];
  let kmCount = 0;
  let offCount = 0;

  for (const p of rows) {
    const c = String(p.ProductID ?? p.ProductCode ?? p.ItemID ?? p.Code ?? "").trim();
    const n = String(p.ProductName ?? p.ItemName ?? p.Name ?? "").trim();
    const u = String(p.UnitOfMeasure ?? p.Unit ?? "Hộp").trim();
    if (!c || seen.has(c)) continue;

    if (isKmProduct(c, n)) {
      kmCount++;
      continue;
    }
    if (isOffProduct(c, n)) {
      offCount++;
      continue;
    }

    seen.add(c);
    items.push({ c, n, u });
  }

  items.sort((a, b) => a.n.localeCompare(b.n, 'vi'));
  console.log(`[sync-catalog] Kết quả sau lọc: ${items.length} sản phẩm sạch (Đã lọc ${kmCount} sản phẩm KM & ${offCount} sản phẩm Dừng).`);

  if (!items.length) {
    console.warn("[sync-catalog] Cảnh báo: Danh sách lọc bị rỗng, bỏ qua cập nhật.");
    return;
  }

  const catalogPayload = {
    updatedAt: Date.now(),
    count: items.length,
    items,
  };

  console.log("[sync-catalog] Đang đẩy product_catalog.json lên Firebase Realtime Database...");
  await withTimeout(
    db.ref("product_catalog").set(catalogPayload),
    FIREBASE_WRITE_TIMEOUT_MS,
    "ghi product_catalog lên Firebase"
  );
  console.log(`[sync-catalog] ✅ Đã lưu ${items.length} sản phẩm thành công lên Firebase RTDB node /product_catalog!`);

  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(path.join(DATA_DIR, "product_catalog.json"), JSON.stringify(catalogPayload, null, 2));
    console.log(`[sync-catalog] ✅ Đã lưu bản backup cục bộ tại src/assets/data/product_catalog.json`);
  } catch (err) {
    console.warn("[sync-catalog] Không thể lưu file backup cục bộ:", err.message);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`=== HOÀN THÀNH CRONJOB (Thời gian: ${elapsed}s) ===`);
}

run().catch((err) => {
  console.error("[sync-catalog] ❌ Lỗi Cronjob:", err.message || err);
  process.exit(1);
});
