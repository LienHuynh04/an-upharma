/**
 * Script: Tính toán & lưu sẵn Gợi Ý Điều Chuyển Hàng Cận Date lên Firebase
 * Đường dẫn Firebase output: /transfer_suggestions_cache/<SHOP_CODE>.json
 *
 * Cách chạy:
 * node scripts/generate_transfer_suggestions.js
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const FIREBASE_DB_URL = "https://an-upharma-default-rtdb.firebaseio.com";

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

function putJson(url, payload) {
  return new Promise((resolve, reject) => {
    const dataString = JSON.stringify(payload);
    const parsedUrl = new URL(url);

    const req = https.request(
      parsedUrl,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(dataString),
        },
      },
      (res) => {
        let responseData = "";
        res.on("data", (chunk) => (responseData += chunk));
        res.on("end", () => resolve(responseData));
      }
    );

    req.on("error", reject);
    req.write(dataString);
    req.end();
  });
}

function parseDaysRemaining(row, now = new Date()) {
  const expStr = String(
    row.ExpirationDate ||
      row.ExpDate ||
      row.ExpireDate ||
      row.ExpiredDate ||
      row.ExpiryDate ||
      row.DateExpire ||
      row.HSD ||
      ""
  ).trim();

  if (!expStr) return null;

  const d = new Date(expStr.replace(" ", "T"));
  if (!isNaN(d.getTime())) {
    now.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  }

  const parts = expStr.split(/[-/T ]/);
  if (parts.length >= 3) {
    let day, month, year;
    if (parts[2].length === 4) {
      day = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10) - 1;
      year = parseInt(parts[2], 10);
    } else if (parts[0].length === 4) {
      year = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10) - 1;
      day = parseInt(parts[2], 10);
    }
    if (year && !isNaN(month) && day) {
      const exp = new Date(year, month, day);
      now.setHours(0, 0, 0, 0);
      return Math.round((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    }
  }

  return null;
}

async function main() {
  console.log("🚀 [Transfer Suggestions] Bắt đầu tính toán Gợi ý Điều chuyển Toàn Quốc...");

  // 1. Tải cache tồn kho & sức bán toàn quốc từ Firebase
  console.log("📥 Đang tải national_inventory_cache.json từ Firebase...");
  const nationalCache = await fetchJson(`${FIREBASE_DB_URL}/national_inventory_cache.json`);

  if (!nationalCache) {
    console.error("❌ Không tải được national_inventory_cache.json");
    return;
  }

  const cacheKeys = Object.keys(nationalCache);
  console.log(`✅ Đã tải dữ liệu tồn kho toàn quốc với ${cacheKeys.length} mã sản phẩm.`);

  // 2. Đọc tồn kho các shop từ inventory.json
  const invPath = path.join(__dirname, "../src/assets/data/inventory.json");
  if (!fs.existsSync(invPath)) {
    console.error("❌ Không tìm thấy file inventory.json tại:", invPath);
    return;
  }

  const invData = JSON.parse(fs.readFileSync(invPath, "utf8"));
  const rawRows = invData.data || [];
  console.log(`📦 Đã đọc ${rawRows.length} dòng tồn kho từ inventory.json.`);

  // Tìm danh sách các shop
  const shopSet = new Set();
  rawRows.forEach((r) => {
    const sc = String(r.__shopCode || r.StoreCode || r.ShopCode || "").trim();
    if (sc) shopSet.add(sc);
  });

  const shopCodes = Array.from(shopSet);
  console.log(`🏠 Danh sách nhà thuốc nguồn:`, shopCodes);

  const now = new Date();

  // 3. Với mỗi nhà thuốc, tính toán gợi ý và ghi lên Firebase
  for (const shopCode of shopCodes) {
    console.log(`⏳ Đang xử lý gợi ý điều chuyển cho shop: ${shopCode}...`);

    const shopRows = rawRows.filter(
      (r) => String(r.__shopCode || r.StoreCode || r.ShopCode || "").trim() === shopCode
    );

    const expiringStockList = [];
    const nationalStoreStockMap = {};

    shopRows.forEach((row, idx) => {
      const pCode = String(row.ProductID || row.ProductCode || row.ItemCode || "").trim();
      const pName = String(row.ProductName || row.ItemName || pCode).trim();
      const qty = Number(row.Quantity ?? row.QuantityExist ?? 0);
      const days = parseDaysRemaining(row, new Date(now));
      const expText = String(
        row.ExpirationDate ||
          row.ExpDate ||
          row.ExpireDate ||
          row.ExpiredDate ||
          row.ExpiryDate ||
          row.DateExpire ||
          row.HSD ||
          ""
      ).trim();

      // Chỉ lấy các mặt hàng còn hạn dùng (hoặc cận date <= 365 ngày) và số lượng tồn > 0
      if (pCode && qty > 0 && days !== null && days >= 0 && days <= 365) {
        expiringStockList.push({
          key: `${shopCode}_${pCode}_${idx}`,
          productCode: pCode,
          productName: pName,
          shopCode: shopCode,
          shopName: String(row.__shopName || row.StoreName || shopCode).trim(),
          lot: String(row.LotCode || row.Lot || "N/A"),
          expiryText: expText,
          daysRemaining: days,
          quantity: qty,
          unit: String(row.UnitOfMeasure || row.Unit || "Hộp"),
        });

        // Ghép nối danh sách nhà thuốc tiếp nhận trên toàn quốc
        const safeCode = pCode.replace(/[.$#[\]/]/g, "_");
        const upperCode = pCode.toUpperCase();
        const entry = nationalCache[safeCode] || nationalCache[pCode] || nationalCache[upperCode];

        if (entry && Array.isArray(entry.shops) && entry.shops.length > 0) {
          nationalStoreStockMap[pCode] = entry.shops;
        }
      }
    });

    // Sắp xếp các mặt hàng theo hạn dùng gần nhất lên trước
    expiringStockList.sort((a, b) => a.daysRemaining - b.daysRemaining);

    const payload = {
      shopCode,
      updatedAt: Date.now(),
      totalExpiringCount: expiringStockList.length,
      expiringStockList,
      nationalStoreStockMap,
    };

    const sanitized = shopCode.trim().replace(/[.$#\[\]\/]/g, "_");
    await putJson(`${FIREBASE_DB_URL}/transfer_suggestions_cache/${sanitized}.json`, payload);
    console.log(
      `✅ Đã cập nhật xong cache cho shop ${shopCode}: ${expiringStockList.length} mặt hàng cận date, ${Object.keys(nationalStoreStockMap).length} mã có điểm đến toàn quốc.`
    );
  }

  console.log("🎉 [Transfer Suggestions] HOÀN TẤT CẬP NHẬT TẤT CẢ GỢI Ý ĐIỀU CHUYỂN LÊN FIREBASE RTDB!");
}

main().catch((err) => {
  console.error("❌ Lỗi:", err);
});
