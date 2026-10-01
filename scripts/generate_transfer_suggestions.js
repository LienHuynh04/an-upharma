/**
 * CronJob Script: Tự động tính toán & lưu sẵn Gợi Ý Điều Chuyển Hàng Cận Date lên Firebase
 * Đường dẫn Firebase output: /transfer_suggestions_cache/<SHOP_CODE>.json
 * 
 * Cách chạy:
 * node scripts/generate_transfer_suggestions.js
 */

const https = require("https");

const FIREBASE_DB_URL = "https://an-upharma-default-rtdb.firebaseio.com";

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
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

async function main() {
  console.log("🚀 [CronJob] Bắt đầu tự động tổng hợp & tính toán Gợi ý Điều chuyển...");

  // 1. Tải cache tồn kho & sức bán toàn quốc từ Firebase
  console.log("📥 Đang tải national_inventory_cache.json từ Firebase...");
  const nationalCache = await fetchJson(`${FIREBASE_DB_URL}/national_inventory_cache.json`);

  if (!nationalCache) {
    console.error("❌ Không tải được national_inventory_cache.json");
    return;
  }

  console.log(`✅ Đã tải dữ liệu tồn kho toàn quốc với ${Object.keys(nationalCache).length} mã sản phẩm.`);

  // 2. Tìm danh sách tất cả nhà thuốc
  const shopSet = new Set();
  Object.values(nationalCache).forEach((item) => {
    if (Array.isArray(item.shops)) {
      item.shops.forEach((shop) => {
        if (shop.StoreCode) shopSet.add(shop.StoreCode);
      });
    }
  });

  const shopCodes = Array.from(shopSet);
  console.log(`🏠 Tìm thấy ${shopCodes.length} nhà thuốc trong hệ thống.`);

  // 3. Với mỗi nhà thuốc, tổng hợp gợi ý và ghi lên Firebase /transfer_suggestions_cache/<SHOP_CODE>.json
  for (const shopCode of shopCodes) {
    console.log(`⏳ Đang xử lý gợi ý điều chuyển cho shop: ${shopCode}...`);

    const expiringStockList = [];
    const nationalStoreStockMap = {};

    Object.entries(nationalCache).forEach(([pCode, entry]) => {
      if (!entry || !Array.isArray(entry.shops)) return;

      const shopStock = entry.shops.find((s) => s.StoreCode === shopCode);
      if (shopStock && shopStock.QuantityExist > 0) {
        expiringStockList.push({
          key: `${shopCode}_${pCode}`,
          productCode: pCode,
          productName: entry.productName || shopStock.ProductName || pCode,
          shopCode: shopCode,
          shopName: shopStock.StoreName || shopCode,
          lot: shopStock.Lot || "N/A",
          expiryText: shopStock.ExpiryDate || "180 ngày",
          daysRemaining: shopStock.DaysRemaining || 90,
          quantity: shopStock.QuantityExist,
          unit: shopStock.UnitOfMeasure || "Hộp",
        });

        nationalStoreStockMap[pCode] = entry.shops;
      }
    });

    const payload = {
      shopCode,
      updatedAt: Date.now(),
      totalExpiringCount: expiringStockList.length,
      expiringStockList,
      nationalStoreStockMap,
    };

    const sanitized = shopCode.trim().replace(/[.$#\[\]\/]/g, "_");
    await putJson(`${FIREBASE_DB_URL}/transfer_suggestions_cache/${sanitized}.json`, payload);
    console.log(`✅ Đã cập nhật xong cache cho shop: ${shopCode}`);
  }

  console.log("🎉 [CronJob] HOÀN TẤT CẬP NHẬT TẤT CẢ GỢI Ý ĐIỀU CHUYỂN LÊN FIREBASE!");
}

main().catch((err) => {
  console.error("❌ Lỗi CronJob:", err);
});
