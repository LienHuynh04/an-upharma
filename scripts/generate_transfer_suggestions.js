/**
 * Script: Tính toán sẵn toàn bộ Gợi Ý Điều Chuyển Hàng Cận Date (Server Pre-computed Snapshot)
 * Đưa lên Firebase RTDB /transfer_suggestions_cache/<SHOP_CODE>.json
 * Kết quả: Client chỉ cần tải đúng 1 file siêu nhẹ (~20KB, mất 30ms) là hiển thị ngay tức thì!
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
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(responseData);
          } else {
            reject(new Error(`Firebase PUT failed HTTP ${res.statusCode}: ${responseData}`));
          }
        });
      }
    );

    req.on("error", reject);
    req.write(dataString);
    req.end();
  });
}

function getProvince(name) {
  if (!name) return "";
  const n = name.toLowerCase();
  if (n.includes("đà nẵng") || n.includes("da nang") || n.includes("đn")) return "Đà Nẵng";
  if (n.includes("khánh hòa") || n.includes("khanh hoa") || n.includes("nha trang")) return "Khánh Hòa";
  if (n.includes("gia lai") || n.includes("pleiku")) return "Gia Lai";
  if (n.includes("hồ chí minh") || n.includes("hcm") || n.includes("tphcm") || n.includes("sài gòn")) return "Hồ Chí Minh";
  if (n.includes("hà nội") || n.includes("ha noi")) return "Hà Nội";
  if (n.includes("bình định") || n.includes("binh dinh") || n.includes("quy nhơn")) return "Bình Định";
  if (n.includes("quảng nam") || n.includes("quang nam")) return "Quảng Nam";
  if (n.includes("quảng ngãi") || n.includes("quang ngai")) return "Quảng Ngãi";
  if (n.includes("thừa thiên huế") || n.includes("thua thien hue") || n.includes("huế")) return "Thừa Thiên Huế";
  if (n.includes("đắk lắk") || n.includes("dak lak") || n.includes("buôn ma thuột")) return "Đắk Lắk";
  if (n.includes("lâm đồng") || n.includes("lam dong") || n.includes("đà lạt")) return "Lâm Đồng";
  if (n.includes("cần thơ") || n.includes("can tho")) return "Cần Thơ";

  const parts = name.trim().split(/[-,-]/);
  return parts[parts.length - 1]?.trim() || name;
}

function isWarehouse(store) {
  if (!store) return false;
  const code = String(store.StoreCode || store.ShopCode || "").toUpperCase().trim();
  const name = String(store.StoreName || store.ShopName || "").toLowerCase().trim();
  const type = String(store.StoreType || "").toLowerCase().trim();
  if (type.includes("kho")) return true;
  if (code === "DN" || code.startsWith("KHO") || code.startsWith("K_")) return true;
  if (name.includes("kho tổng") || name.includes("kho tong") || /\bkho\b/i.test(name)) return true;
  return false;
}

function parseDaysRemaining(row, now = new Date()) {
  const expStr = String(
    row.ExpirationDate || row.ExpDate || row.ExpireDate || row.ExpiredDate || row.ExpiryDate || row.DateExpire || row.HSD || ""
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

function computeSuggestionsForRows(rows, nationalCache, now = new Date()) {
  const suggestions = [];

  for (let idx = 0; idx < rows.length; idx++) {
    const row = rows[idx];
    const pCode = String(row.ProductID || row.ProductCode || "").trim();
    const pName = String(row.ProductName || row.ItemName || pCode).trim();
    const sc = String(row.__shopCode || row.StoreCode || row.ShopCode || "").trim();
    const sName = String(row.__shopName || row.StoreName || sc).trim();
    const qty = Number(row.Quantity ?? row.QuantityExist ?? 0);
    const expText = String(
      row.ExpirationDate || row.ExpDate || row.ExpireDate || row.ExpiryDate || ""
    ).trim();
    const days = parseDaysRemaining(row, now);

    if (!pCode || qty <= 0 || days === null || days < 0 || days > 365) continue;

    const safeCode = pCode.replace(/[.$#[\]/]/g, "_");
    const upperCode = pCode.toUpperCase();
    const entry = nationalCache[safeCode] || nationalCache[pCode] || nationalCache[upperCode];

    if (!entry || !Array.isArray(entry.shops) || entry.shops.length === 0) continue;

    // Lọc bỏ chính shop nguồn và kho
    const candidates = entry.shops.filter((d) => d.StoreCode !== sc && !isWarehouse(d));
    if (candidates.length === 0) continue;

    const sourceProvince = getProvince(sName);

    // Phân 4 cấp ưu tiên để luôn chọn đủ 5 nhà thuốc:
    // 1. Nội tỉnh bán tốt (QuantityAVG > 0)
    const sameProvSales = candidates
      .filter((d) => getProvince(d.StoreName) === sourceProvince && Number(d.QuantityAVG || d.AVGQuantity || 0) > 0)
      .sort((a, b) => Number(b.QuantityAVG || 0) - Number(a.QuantityAVG || 0));

    // 2. Nội tỉnh khác (QuantityAVG <= 0, ưu tiên giữ hàng trong tỉnh)
    const sameProvOther = candidates
      .filter((d) => getProvince(d.StoreName) === sourceProvince && Number(d.QuantityAVG || d.AVGQuantity || 0) <= 0)
      .sort((a, b) => Number(b.Quantity || 0) - Number(a.Quantity || 0));

    // 3. Ngoại tỉnh bán tốt (QuantityAVG > 0)
    const otherProvSales = candidates
      .filter((d) => getProvince(d.StoreName) !== sourceProvince && Number(d.QuantityAVG || d.AVGQuantity || 0) > 0)
      .sort((a, b) => Number(b.QuantityAVG || 0) - Number(a.QuantityAVG || 0));

    // 4. Ngoại tỉnh khác (QuantityAVG <= 0, dự phòng để đủ 5 shop)
    const otherProvOther = candidates
      .filter((d) => getProvince(d.StoreName) !== sourceProvince && Number(d.QuantityAVG || d.AVGQuantity || 0) <= 0)
      .sort((a, b) => Number(b.Quantity || 0) - Number(a.Quantity || 0));

    // Bắt buộc lấy đúng 5 nhà thuốc (ưu tiên nội tỉnh tuyệt đối)
    const ordered = [...sameProvSales, ...sameProvOther, ...otherProvSales, ...otherProvOther].slice(0, 5);

    ordered.forEach((dest, rankIdx) => {
      const isSame = sourceProvince === getProvince(dest.StoreName);
      const avg = Number(dest.QuantityAVG || 0);
      const suggestedQty = avg > 0
        ? Math.max(1, Math.min(Math.floor(qty), Math.round(avg || 1)))
        : Math.max(1, Math.min(Math.floor(qty), 2));

      suggestions.push({
        key: `${sc}_${pCode}_${idx}_${dest.StoreCode}_${rankIdx}`,
        productCode: pCode,
        productName: pName,
        unit: String(row.UnitOfMeasure || row.Unit || "Hộp"),
        lot: String(row.LotCode || row.Lot || "N/A"),
        expiryText: expText,
        daysRemaining: days,
        fromShopCode: sc,
        fromShopName: sName,
        toShopCode: dest.StoreCode,
        toShopName: dest.StoreName,
        sourceQuantity: qty,
        destAvgSales: avg,
        suggestedQty,
        isSameProvince: isSame,
        rank: rankIdx + 1,
      });
    });
  }

  // Gom nhóm theo fromShopCode + productCode
  const groupMap = new Map();
  for (const item of suggestions) {
    const gKey = `${item.fromShopCode}|${item.productCode}`;
    if (!groupMap.has(gKey)) {
      groupMap.set(gKey, []);
    }
    groupMap.get(gKey).push(item);
  }

  const groupedSuggestions = [];
  groupMap.forEach((items) => {
    if (items.length === 0) return;
    const first = items[0];
    let minDays = first.daysRemaining;
    let minExpiryText = first.expiryText;
    for (const it of items) {
      if (it.daysRemaining < minDays) {
        minDays = it.daysRemaining;
        minExpiryText = it.expiryText;
      }
    }
    const totalSuggestedQty = items.reduce((sum, i) => sum + i.suggestedQty, 0);
    const sameProvCount = items.filter((i) => i.isSameProvince).length;

    groupedSuggestions.push({
      productCode: first.productCode,
      productName: first.productName,
      fromShopCode: first.fromShopCode,
      fromShopName: first.fromShopName,
      unit: first.unit,
      lot: first.lot,
      minDaysRemaining: minDays,
      minExpiryText,
      totalSourceQuantity: first.sourceQuantity,
      totalSuggestedQty,
      suggestionCount: items.length,
      sameProvinceCount: sameProvCount,
      sourceShops: [`${first.fromShopCode} - ${first.fromShopName}`],
      items: items.sort((a, b) => a.rank - b.rank),
    });
  });

  // Tính bucketCounts
  const allKeys = new Set();
  const dangerKeys = new Set();
  const warningKeys = new Set();
  const safeKeys = new Set();
  let allQty = 0, dangerQty = 0, warningQty = 0, safeQty = 0;

  for (const item of suggestions) {
    const k = `${item.fromShopCode}|${item.productCode}`;
    allKeys.add(k);
    allQty += item.suggestedQty;

    if (item.daysRemaining >= 0 && item.daysRemaining <= 90) {
      dangerKeys.add(k);
      dangerQty += item.suggestedQty;
    }
    if (item.daysRemaining > 90 && item.daysRemaining <= 180) {
      warningKeys.add(k);
      warningQty += item.suggestedQty;
    }
    if (item.daysRemaining >= 0 && item.daysRemaining <= 365) {
      safeKeys.add(k);
      safeQty += item.suggestedQty;
    }
  }

  const total = allKeys.size || 1;
  const bucketCounts = {
    all: allKeys.size,
    allQty,
    allRate: "100,00",
    danger: dangerKeys.size,
    dangerQty,
    dangerRate: ((dangerKeys.size / total) * 100).toFixed(2).replace(".", ","),
    warning: warningKeys.size,
    warningQty,
    warningRate: ((warningKeys.size / total) * 100).toFixed(2).replace(".", ","),
    safe: safeKeys.size,
    safeQty,
    safeRate: ((safeKeys.size / total) * 100).toFixed(2).replace(".", ","),
  };

  return { suggestions, groupedSuggestions, bucketCounts };
}

async function main() {
  console.log("🚀 [Instant Cache Builder] Bắt đầu tạo cache tính sẵn siêu tốc...");

  // 1. Tải cache tồn kho toàn quốc từ Firebase
  console.log("📥 Đang tải national_inventory_cache.json từ Firebase...");
  const nationalCache = await fetchJson(`${FIREBASE_DB_URL}/national_inventory_cache.json`);
  if (!nationalCache) {
    console.error("❌ Không tải được national_inventory_cache");
    return;
  }
  console.log(`✅ Đã nạp ${Object.keys(nationalCache).length} mã sản phẩm toàn quốc.`);

  // 2. Đọc tồn kho inventory.json
  const invPath = path.join(__dirname, "../src/assets/data/inventory.json");
  const invData = JSON.parse(fs.readFileSync(invPath, "utf8"));
  const rawRows = invData.data || [];
  console.log(`📦 Đã nạp ${rawRows.length} dòng tồn kho.`);

  const shopSet = new Set();
  rawRows.forEach((r) => {
    const sc = String(r.__shopCode || r.StoreCode || r.ShopCode || "").trim();
    if (sc) shopSet.add(sc);
  });
  const shopCodes = Array.from(shopSet);

  const now = new Date();

  // 3. Tính toán cho từng shop
  for (const shopCode of shopCodes) {
    const shopRows = rawRows.filter(
      (r) => String(r.__shopCode || r.StoreCode || r.ShopCode || "").trim() === shopCode
    );
    const result = computeSuggestionsForRows(shopRows, nationalCache, now);

    const payload = {
      shopCode,
      updatedAt: Date.now(),
      groupedSuggestions: result.groupedSuggestions,
      suggestions: result.suggestions,
      bucketCounts: result.bucketCounts,
      totalExpiringCount: result.groupedSuggestions.length,
    };

    const sanitized = shopCode.trim().replace(/[.$#\[\]\/]/g, "_");
    await putJson(`${FIREBASE_DB_URL}/transfer_suggestions_cache/${sanitized}.json`, payload);
    console.log(
      `✅ [Cache 30ms] Đã lưu ${shopCode}: ${result.groupedSuggestions.length} nhóm SP, ${result.suggestions.length} tuyến gợi ý toàn quốc.`
    );
  }

  // 4. Tính toán cho Tab "ALL" (Tất cả nhà thuốc)
  console.log("⏳ Đang tạo cache tính sẵn cho Tab 'ALL'...");
  const allResult = computeSuggestionsForRows(rawRows, nationalCache, now);
  const allPayload = {
    shopCode: "ALL",
    updatedAt: Date.now(),
    groupedSuggestions: allResult.groupedSuggestions,
    suggestions: allResult.suggestions,
    bucketCounts: allResult.bucketCounts,
    totalExpiringCount: allResult.groupedSuggestions.length,
  };
  await putJson(`${FIREBASE_DB_URL}/transfer_suggestions_cache/ALL.json`, allPayload);
  console.log(
    `✅ [Cache 30ms] Đã lưu ALL: ${allResult.groupedSuggestions.length} nhóm SP, ${allResult.suggestions.length} tuyến gợi ý toàn quốc.`
  );

  console.log("🎉 [Instant Cache Builder] HOÀN TẤT TẠO TOÀN BỘ CACHE SIÊU TỐC LÊN FIREBASE!");
}

main().catch(console.error);
