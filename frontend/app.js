let sessionData = null;
let shopList = [];
let inventoryRows = [];
let activeShopCode = "";
let remoteDatasets = {};

const API_CALLS_ENABLED = window.UPHARMA_ENABLE_API === true;
const UPHARMA_API_BASE_URL = String(
  window.UPHARMA_API_BASE_URL || "https://icpc1hn.work/NHATHUOC",
).replace(/\/$/, "");
const EXCLUDED_SHOP_CODES = new Set(["SHOP0040"]);
const PRODUCT_NAME_COLLATOR = new Intl.Collator("vi", { sensitivity: "base", numeric: true });
const inventorySearch = document.querySelector("#inventorySearch");
const columnFilters = document.querySelectorAll("[data-filter]");
const expiryCards = document.querySelectorAll("[data-expiry-filter]");
const shopDashboard = document.querySelector("#shopDashboard");
const inventoryTableCard = document.querySelector(".inventory-table-card");
const mobileFilterToggle = document.querySelector("#mobileFilterToggle");
const appShell = document.querySelector(".app");
const sidebarToggleButtons = document.querySelectorAll(".menu-btn");
const menuParentButtons = document.querySelectorAll("[data-menu-toggle]");
const layoutModeButtons = document.querySelectorAll("[data-layout-mode]");
const n8nWorkflowLinks = document.querySelectorAll("[data-n8n-workflow]");
const n8nExampleButtons = document.querySelectorAll("[data-n8n-example]");
const n8nDialog = document.querySelector("#n8nDialog");
const loadingOverlay = document.querySelector("#loadingOverlay");
const loadingTitle = document.querySelector("#loadingTitle");
const loadingTasks = new Map();
const EXPIRY_FILTER_LOADING_MS = 3000;
const UPHARMA_RESOURCE_NAMES = ["inventory", "invoices", "messages", "employees", "orders"];
const N8N_WORKFLOW_EXAMPLES = {
  expiry: {
    label: "QUY TRÌNH MẪU 01",
    title: "Cảnh báo thuốc sắp hết hạn",
    description: "Tự động kiểm tra hạn dùng tại tất cả nhà thuốc và cảnh báo các lô còn không quá 90 ngày.",
    result: "Kết quả: quản lý nhận danh sách theo nhà thuốc, mã sản phẩm, số lô và hạn dùng.",
    steps: [
      ["Kích hoạt", "07:00 mỗi ngày", "Schedule Trigger"],
      ["Lấy dữ liệu", "Gọi API 3 nhà thuốc", "HTTP Request"],
      ["Xử lý", "Lọc hạn dùng ≤ 90 ngày", "Filter / Code"],
      ["Thông báo", "Gửi Email hoặc Zalo", "Email / Webhook"],
    ],
  },
  inventory: {
    label: "QUY TRÌNH MẪU 02",
    title: "Đồng bộ tồn kho nhiều nhà thuốc",
    description: "Gom tồn kho của mọi ShopCode thành một nguồn dữ liệu chung để tra cứu và làm báo cáo.",
    result: "Kết quả: dữ liệu tồn kho hợp nhất được cập nhật định kỳ mà không cần tải từng cửa hàng.",
    steps: [
      ["Kích hoạt", "Mỗi 30 phút", "Schedule Trigger"],
      ["Lặp cửa hàng", "Đọc danh sách ShopCode", "Loop Over Items"],
      ["Đồng bộ", "Gọi API và chuẩn hóa", "HTTP Request / Edit Fields"],
      ["Lưu dữ liệu", "Database hoặc Google Sheets", "Postgres / Sheets"],
    ],
  },
  report: {
    label: "QUY TRÌNH MẪU 03",
    title: "Gửi báo cáo cuối ngày",
    description: "Tổng hợp đơn hàng, doanh thu và tồn kho vào cuối ca rồi gửi cho người quản lý.",
    result: "Kết quả: báo cáo cuối ngày được gửi đúng giờ, cùng một định dạng cho tất cả nhà thuốc.",
    steps: [
      ["Kích hoạt", "21:30 mỗi ngày", "Schedule Trigger"],
      ["Thu thập", "Đơn hàng và tồn kho", "HTTP Request"],
      ["Tổng hợp", "Tính chỉ số theo cửa hàng", "Aggregate / Code"],
      ["Gửi báo cáo", "Email cho quản lý", "Email"],
    ],
  },
};

function renderLoadingState() {
  if (!loadingOverlay) {
    return;
  }

  const tasks = Array.from(loadingTasks.values());
  const currentTask = tasks[tasks.length - 1];
  const isLoading = tasks.length > 0;

  if (currentTask) {
    loadingTitle.textContent = currentTask.title;
  }

  loadingOverlay.classList.toggle("is-visible", isLoading);
  document.body.classList.toggle("is-loading", isLoading);
}

function startLoading(taskId, title = "Đang tải dữ liệu") {
  loadingTasks.set(taskId, { title });
  renderLoadingState();
}

function stopLoading(taskId) {
  loadingTasks.delete(taskId);
  renderLoadingState();
}

function setText(selector, value) {
  const element = document.querySelector(selector);

  if (element) {
    element.textContent = value;
  }
}

function updateMobileFilterSummary() {
  const columnFilterCount = Array.from(columnFilters).filter((filter) => filter.value.trim()).length;
  const activeFilterCount = columnFilterCount + (activeShopCode ? 1 : 0);
  const summary = activeFilterCount > 0 ? `${activeFilterCount} bộ lọc đang dùng` : "Chưa có bộ lọc";

  setText("#mobileFilterSummary", summary);
}

function renderN8nExample(workflowKey) {
  const workflow = N8N_WORKFLOW_EXAMPLES[workflowKey] || N8N_WORKFLOW_EXAMPLES.expiry;
  const flow = document.querySelector("#n8nFlow");

  setText("#n8nExampleLabel", workflow.label);
  setText("#n8nExampleTitle", workflow.title);
  setText("#n8nExampleDescription", workflow.description);
  setText("#n8nResult", workflow.result);

  if (flow) {
    flow.innerHTML = workflow.steps
      .map(
        ([type, title, node], index) => `
          <li>
            <span class="n8n-step-number">${index + 1}</span>
            <small>${escapeHtml(type)}</small>
            <strong>${escapeHtml(title)}</strong>
            <em>${escapeHtml(node)}</em>
          </li>
        `,
      )
      .join("");
  }

  n8nExampleButtons.forEach((button) => {
    const isActive = button.dataset.n8nExample === workflowKey;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
}

function openN8nExample(workflowKey) {
  if (!n8nDialog) {
    return;
  }

  renderN8nExample(workflowKey);

  if (!n8nDialog.open) {
    n8nDialog.showModal();
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatUpharmaDateTime(date) {
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

function getUpharmaResourceConfig(resourceName, now = new Date()) {
  const currentTime = formatUpharmaDateTime(now);
  const today = currentTime.slice(0, 10);
  const twoMonthsAgo = new Date(now);
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

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
      payload: () => ({ TimeStart: formatUpharmaDateTime(twoMonthsAgo), TimeEnd: currentTime }),
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

function extractUpharmaArray(data) {
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

async function requestUpharmaDirect(pathname, payload) {
  const response = await fetch(`${UPHARMA_API_BASE_URL}${pathname}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const responseText = await response.text();
  let data;

  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    throw new Error(`${pathname}: response không phải JSON`);
  }

  if (!response.ok) {
    throw new Error(`${pathname}: HTTP ${response.status}`);
  }

  if (Object.hasOwn(data, "RespCode") && Number(data.RespCode) !== 0) {
    throw new Error(data.RespText || `${pathname}: RespCode ${data.RespCode}`);
  }

  return data;
}

async function loginUpharmaDirect() {
  const account = window.UPHARMA_ACCOUNT;

  if (!account?.UserName || !account?.Password) {
    throw new Error("Thiếu tài khoản tự đăng nhập trong frontend/config.js");
  }

  const loginData = await requestUpharmaDirect("/User/UserLogin", {
    UserName: account.UserName,
    Password: account.Password,
  });

  if (!loginData.Token || !loginData.UserInfo?.uPharmaID || !Array.isArray(loginData.UserInfo.ShopLst)) {
    throw new Error(loginData.RespText || "Response đăng nhập không hợp lệ");
  }

  return loginData;
}

async function fetchUpharmaResourceDirect(resourceName) {
  const config = getUpharmaResourceConfig(resourceName);
  const data = [];
  const failedShops = [];

  if (!config) {
    throw new Error(`Không hỗ trợ nhóm API: ${resourceName}`);
  }

  for (const shop of shopList) {
    try {
      const responseData = await requestUpharmaDirect(config.pathname, {
        ...config.payload(),
        Token: sessionData.Token,
        uPharmaID: String(sessionData.UserInfo.uPharmaID),
        ShopCode: shop.ShopCode,
      });
      const shopRows = extractUpharmaArray(responseData).map((item) => ({
        ...item,
        __shopCode: shop.ShopCode,
        __shopName: shop.ShopName,
      }));

      data.push(...shopRows);
    } catch (error) {
      failedShops.push(`${shop.ShopCode}: ${error.message}`);
    }
  }

  if (failedShops.length === shopList.length) {
    throw new Error(`${label}: tất cả nhà thuốc đều lỗi (${failedShops.join(", ")})`);
  }

  return {
    success: true,
    resource: resourceName,
    user: {
      uPharmaID: sessionData.UserInfo.uPharmaID,
      FullName: sessionData.UserInfo.FullName,
      Email: sessionData.UserInfo.Email,
    },
    shops: shopList,
    data,
    failedShops,
    fetchedAt: new Date().toISOString(),
  };
}

function formatMoney(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return value ?? "";
  }

  return new Intl.NumberFormat("vi-VN").format(number);
}

function pick(row, keys, fallback = "") {
  const normalizedMap = new Map(
    Object.keys(row || {}).map((key) => [key.toLowerCase().replaceAll("_", ""), key]),
  );

  for (const key of keys) {
    const directValue = row?.[key];

    if (directValue !== undefined && directValue !== null && directValue !== "") {
      return directValue;
    }

    const normalizedKey = key.toLowerCase().replaceAll("_", "");
    const matchedKey = normalizedMap.get(normalizedKey);

    if (matchedKey && row[matchedKey] !== undefined && row[matchedKey] !== null && row[matchedKey] !== "") {
      return row[matchedKey];
    }
  }

  return fallback;
}

function pickByKeywords(row, includeKeywords, excludeKeywords = []) {
  const entries = Object.entries(row || {});

  for (const [key, value] of entries) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    const normalizedKey = key.toLowerCase();
    const hasIncludedKeyword = includeKeywords.some((keyword) => normalizedKey.includes(keyword));
    const hasExcludedKeyword = excludeKeywords.some((keyword) => normalizedKey.includes(keyword));

    if (hasIncludedKeyword && !hasExcludedKeyword) {
      return value;
    }
  }

  return "";
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  const text = String(value).trim();
  const aspNetDate = text.match(/\/Date\((\d+)\)\//);

  if (aspNetDate) {
    return new Date(Number(aspNetDate[1]));
  }

  const ddmmyyyy = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);

  if (ddmmyyyy) {
    return new Date(Number(ddmmyyyy[3]), Number(ddmmyyyy[2]) - 1, Number(ddmmyyyy[1]));
  }

  const date = new Date(text.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatInventoryDate(value) {
  const date = parseDate(value);

  if (!date) {
    return value ?? "";
  }

  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
    .format(date)
    .replaceAll("/", "-");
}

function expiryClass(value) {
  const date = parseDate(value);

  if (!date) {
    return "normal";
  }

  const now = new Date();
  const diffDays = Math.ceil((date - now) / 86400000);

  if (diffDays < 0) {
    return "expired";
  }

  if (diffDays <= 90) {
    return "danger";
  }

  if (diffDays <= 180) {
    return "warning";
  }

  if (diffDays <= 365) {
    return "safe";
  }

  return "normal";
}

function normalizeInventoryRow(row) {
  const productName = pick(row, ["ProductName", "Product_Name", "ProductFullName", "Product_Name_Full", "TenSP", "TenSanPham", "Name", "ItemName"]);
  const expiry = pick(row, [
    "ExpDate",
    "ExpireDate",
    "ExpiredDate",
    "ExpiryDate",
    "ExpDateTxt",
    "ExpDateText",
    "ExpireDateTxt",
    "ExpiredDateTxt",
    "HanDung",
    "HSD",
    "DateExp",
    "DateExpired",
    "DateExpire",
    "UseDate",
    "ValidDate",
    "ShelfLifeDate",
    "LotExpireDate",
    "NgayHetHan",
    "NgayHSD",
  ], pickByKeywords(row, ["exp", "expire", "expiry", "handung", "hsd", "hethan"], ["create", "update", "import", "input"]));

  const unit = pick(row, [
    "UnitName",
    "Unit_Name",
    "Unit",
    "UnitCode",
    "UnitText",
    "UnitTxt",
    "BaseUnit",
    "BaseUnitName",
    "ProductUnit",
    "ProductUnitName",
    "PackageUnit",
    "PackageUnitName",
    "MeasureUnit",
    "MeasureUnitName",
    "UOM",
    "Uom",
    "UomName",
    "DonVi",
    "DonViTinh",
    "TenDonVi",
    "DVT",
    "Dvt",
  ], pickByKeywords(row, ["unit", "uom", "donvi", "dvt"], ["price", "quantity", "qty"]));

  return {
    productName: String(productName ?? "").trim(),
    productCode: pick(row, ["ProductCode", "ProductID", "Product_ID", "MaSP", "MaSanPham", "ItemCode", "Code"]),
    shopCode: row.__shopCode,
    shopName: row.__shopName,
    shop: row.__shopCode,
    price: pick(row, ["Price", "Gia", "GiaBan", "SalePrice", "RetailPrice", "UnitPrice", "PriceVAT", "PriceSell"]),
    lot: pick(row, ["LotCode", "LotNo", "Lo", "SoLo", "BatchNo", "BatchCode"]),
    expiry,
    expiryText: formatInventoryDate(expiry),
    expiryStatus: expiryClass(expiry),
    quantity: pick(row, ["Quantity", "Qty", "SL", "SoLuong", "InventoryQuantity", "StockQty", "TonKho", "RemainQty"]),
    unit,
    vat: pick(row, ["VAT", "Vat", "VATRate", "Tax"]),
  };
}

function normalizeFilterText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function getColumnFilterValues() {
  return Array.from(columnFilters).reduce((filters, element) => {
    filters[element.dataset.filter] = normalizeFilterText(element.value);
    return filters;
  }, {});
}

function getColumnSearchText(item, key) {
  if (key === "price") {
    return `${item.price ?? ""} ${formatMoney(item.price)}`;
  }

  if (key === "shop") {
    return `${item.shopCode ?? ""} ${item.shop ?? ""}`;
  }

  return item[key] ?? "";
}

function matchesColumnFilters(item, filters) {
  return Object.entries(filters).every(([key, value]) => {
    if (!value) {
      return true;
    }

    return normalizeFilterText(getColumnSearchText(item, key)).includes(value);
  });
}

function compareProductNames(firstName, secondName) {
  const firstStartsWithLetter = /^\p{L}/u.test(String(firstName).trim());
  const secondStartsWithLetter = /^\p{L}/u.test(String(secondName).trim());

  if (firstStartsWithLetter !== secondStartsWithLetter) {
    return firstStartsWithLetter ? -1 : 1;
  }

  return PRODUCT_NAME_COLLATOR.compare(firstName, secondName);
}

function renderInventory() {
  updateMobileFilterSummary();
  const keyword = normalizeFilterText(inventorySearch?.value);
  const filters = getColumnFilterValues();
  const filteredRows = inventoryRows
    .map(normalizeInventoryRow)
    .filter((item) => !activeShopCode || item.shopCode === activeShopCode)
    .filter((item) => {
      const matchesGlobalSearch = normalizeFilterText(Object.values(item).join(" ")).includes(keyword);
      return matchesGlobalSearch && matchesColumnFilters(item, filters);
    })
    .sort(
      (firstItem, secondItem) =>
        compareProductNames(firstItem.productName, secondItem.productName) ||
        PRODUCT_NAME_COLLATOR.compare(firstItem.shopCode, secondItem.shopCode),
    );

  const tbody = document.querySelector("#inventoryRows");

  if (filteredRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-row">Không có dữ liệu tồn kho</td></tr>`;
    return;
  }

  tbody.innerHTML = filteredRows
    .map(
      (item, index) => `
        <tr class="${item.expiryStatus} is-collapsed">
          <td class="index-cell" data-label="STT">${index + 1}</td>
          <td class="product-cell" data-label="Tên SP">
            <span class="desktop-product-name">${escapeHtml(item.productName)}</span>
            <button
              class="record-toggle"
              type="button"
              data-record-toggle
              aria-expanded="false"
              aria-label="Mở chi tiết ${escapeHtml(item.productName)}"
            >
              <span class="record-toggle-index">${index + 1}</span>
              <span class="record-toggle-copy">
                <strong>${escapeHtml(item.productName)}</strong>
                <small>${escapeHtml(item.productCode)} - ${escapeHtml(item.shopCode)}</small>
              </span>
              <span class="record-toggle-icon" aria-hidden="true">⌄</span>
            </button>
          </td>
          <td class="code-cell" data-label="Mã SP">${escapeHtml(item.productCode)}</td>
          <td class="shop-cell" data-label="Nhà thuốc" data-shop-code="${escapeHtml(item.shopCode)}">
            <span class="shop-code">${escapeHtml(item.shopCode)}</span>
          </td>
          <td class="number-cell" data-label="Giá(VNĐ)">${escapeHtml(formatMoney(item.price))}</td>
          <td class="lot-cell" data-label="Lô">${escapeHtml(item.lot)}</td>
          <td class="date-cell" data-label="Hạn dùng">${escapeHtml(item.expiryText)}</td>
          <td class="number-cell quantity-cell" data-label="SL">${escapeHtml(item.quantity)}</td>
          <td data-label="Đơn vị">${escapeHtml(item.unit)}</td>
          <td class="number-cell" data-label="VAT(%)">${escapeHtml(item.vat)}</td>
        </tr>
      `,
    )
    .join("");
}

function updateExpiryDashboard() {
  const rowsForSummary = inventoryRows.filter((row) => {
    const item = normalizeInventoryRow(row);
    return !activeShopCode || item.shopCode === activeShopCode;
  });
  const summary = rowsForSummary.reduce(
    (counts, row) => {
      const item = normalizeInventoryRow(row);

      if (counts[item.expiryStatus] !== undefined) {
        counts[item.expiryStatus] += 1;
      }

      return counts;
    },
    {
      expired: 0,
      danger: 0,
      warning: 0,
      safe: 0,
      normal: 0,
    },
  );

  setText("#expiredCount", summary.expired);
  setText("#threeMonthCount", summary.danger);
  setText("#sixMonthCount", summary.warning);
  setText("#oneYearCount", summary.safe);
  setText("#normalCount", summary.normal);
}

function setActiveExpiryCard(value) {
  expiryCards.forEach((card) => {
    card.classList.toggle("is-active", card.dataset.expiryFilter === value);
  });
}

function renderShopDashboard() {
  if (!shopDashboard) {
    return;
  }

  const shopCounts = inventoryRows.reduce((counts, row) => {
    const shopCode = row.__shopCode || row.ShopCode || "";

    if (shopCode) {
      counts.set(shopCode, (counts.get(shopCode) || 0) + 1);
    }

    return counts;
  }, new Map());
  const cards = [
    {
      shopCode: "",
      shopName: `${shopList.length} nhà thuốc`,
      label: "Tất cả nhà thuốc",
      count: inventoryRows.length,
    },
    ...shopList.map((shop) => ({
      shopCode: shop.ShopCode,
      shopName: shop.ShopName,
      label: shop.ShopCode,
      count: shopCounts.get(shop.ShopCode) || 0,
    })),
  ];

  shopDashboard.innerHTML = cards
    .map((card) => {
      const isActive = card.shopCode === activeShopCode;

      return `
        <button
          class="shop-filter-card${isActive ? " is-active" : ""}"
          type="button"
          data-shop-filter="${escapeHtml(card.shopCode)}"
          aria-pressed="${isActive}"
          title="${escapeHtml(card.shopName)}"
        >
          <span class="shop-filter-copy">
            <b>${escapeHtml(card.label)}</b>
            <small>${escapeHtml(card.shopName)}</small>
          </span>
          <strong>${card.count}</strong>
        </button>
      `;
    })
    .join("");
}

function applyShopFilter(shopCode) {
  activeShopCode = shopList.some((shop) => shop.ShopCode === shopCode) ? shopCode : "";
  renderShopDashboard();
  updateExpiryDashboard();
  renderInventory();
}

function loadStaticInventory() {
  const staticData = window.UPHARMA_STATIC_DATA;

  if (!staticData?.user || !Array.isArray(staticData.shops) || !Array.isArray(staticData.inventory)) {
    console.error("Không tìm thấy dữ liệu tĩnh trong frontend/static-data.js");
    return;
  }

  activeShopCode = "";
  shopList = staticData.shops
    .filter((shop) => !EXCLUDED_SHOP_CODES.has(shop.ShopCode))
    .sort((firstShop, secondShop) => PRODUCT_NAME_COLLATOR.compare(firstShop.ShopCode, secondShop.ShopCode));
  const availableShopCodes = new Set(shopList.map((shop) => shop.ShopCode));
  inventoryRows = staticData.inventory
    .filter((item) => availableShopCodes.has(item.ShopCode))
    .map((item) => {
      const shop = shopList.find((shopItem) => shopItem.ShopCode === item.ShopCode) || {};

      return {
        ...item,
        __shopCode: item.ShopCode,
        __shopName: shop.ShopName || item.ShopCode,
      };
    });

  setText(
    "#userTitle",
    `${staticData.user.FullName} (ID - ${staticData.user.uPharmaID}) - ${shopList.length} nhà thuốc`,
  );
  setText(".brand span", `${shopList.length} NHÀ THUỐC`);
  renderShopDashboard();
  updateExpiryDashboard();
  renderInventory();
}

async function loadInventory() {
  const reloadButton = document.querySelector("#reloadShopApis");
  if (reloadButton) {
    reloadButton.disabled = true;
  }
  startLoading("inventory", "Đang lấy dữ liệu tồn kho...");

  try {
    sessionData = await loginUpharmaDirect();

    shopList = sessionData.UserInfo.ShopLst
      .filter((shop) => !EXCLUDED_SHOP_CODES.has(shop.ShopCode))
      .sort((firstShop, secondShop) => PRODUCT_NAME_COLLATOR.compare(firstShop.ShopCode, secondShop.ShopCode));

    if (shopList.length === 0) {
      throw new Error("Phiên đăng nhập không có nhà thuốc hợp lệ");
    }

    remoteDatasets = {};
    const failedResources = [];

    for (const resourceName of UPHARMA_RESOURCE_NAMES) {
      try {
        remoteDatasets[resourceName] = await fetchUpharmaResourceDirect(resourceName);
      } catch (error) {
        failedResources.push(error.message);
      }
    }

    const data = remoteDatasets.inventory;

    if (!data) {
      throw new Error(`Không tải được API tồn kho. ${failedResources.join(", ")}`);
    }

    window.UPHARMA_REMOTE_DATA = remoteDatasets;

    const shopMap = new Map(shopList.map((shop) => [shop.ShopCode, shop]));
    inventoryRows = (data.data || [])
      .filter((row) => shopMap.has(row.__shopCode || row.ShopCode))
      .map((row) => {
        const shopCode = row.__shopCode || row.ShopCode;
        const shop = shopMap.get(shopCode);

        return {
          ...row,
          __shopCode: shopCode,
          __shopName: row.__shopName || shop.ShopName,
        };
      });
    activeShopCode = shopList.some((shop) => shop.ShopCode === activeShopCode) ? activeShopCode : "";

    setText(
      "#userTitle",
      `${data.user.FullName} (ID - ${data.user.uPharmaID}) - ${shopList.length} nhà thuốc`,
    );
    setText(".brand span", `${shopList.length} NHÀ THUỐC`);
    renderShopDashboard();
    updateExpiryDashboard();
    renderInventory();

    const failedShops = Object.values(remoteDatasets).flatMap((resource) => resource.failedShops || []);
    const errors = [...failedResources, ...failedShops];

    if (errors.length) {
      console.warn("Một số API nhà thuốc tải thất bại:", errors);
    }
  } catch (error) {
    console.error("Không thể tải dữ liệu tồn kho:", error);
  } finally {
    if (reloadButton) {
      reloadButton.disabled = false;
    }
    stopLoading("inventory");
  }
}

function setLayoutMode(mode) {
  const nextMode = mode === "top" ? "top" : "left";

  appShell.classList.toggle("layout-top", nextMode === "top");
  appShell.classList.toggle("layout-left", nextMode === "left");
  layoutModeButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.layoutMode === nextMode);
  });
  localStorage.setItem("upharma_layout_mode", nextMode);
}

async function initDashboard() {
  document.querySelector("#reloadShopApis")?.addEventListener("click", loadInventory);
  mobileFilterToggle?.addEventListener("click", () => {
    const isCollapsed = inventoryTableCard.classList.toggle("filters-collapsed");
    mobileFilterToggle.setAttribute("aria-expanded", String(!isCollapsed));
  });
  inventorySearch?.addEventListener("input", renderInventory);
  columnFilters.forEach((filter) => {
    filter.addEventListener("input", () => {
      if (filter.dataset.filter === "shop" && activeShopCode) {
        activeShopCode = "";
        renderShopDashboard();
        updateExpiryDashboard();
      }

      renderInventory();
    });
    filter.addEventListener("change", () => {
      if (filter.dataset.filter === "expiryStatus") {
        setActiveExpiryCard(filter.value);
      }

      renderInventory();
    });
  });

  document.querySelector("#inventoryRows")?.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-record-toggle]");

    if (!toggle) {
      return;
    }

    const row = toggle.closest("tr");
    const isCollapsed = row.classList.toggle("is-collapsed");
    const productName = toggle.querySelector(".record-toggle-copy strong")?.textContent || "sản phẩm";

    toggle.setAttribute("aria-expanded", String(!isCollapsed));
    toggle.setAttribute("aria-label", `${isCollapsed ? "Mở" : "Thu gọn"} chi tiết ${productName}`);
  });

  expiryCards.forEach((card) => {
    card.addEventListener("click", () => {
      startLoading("expiry-filter", "Đang lọc dữ liệu");
      const expiryFilter = document.querySelector('[data-filter="expiryStatus"]');
      const nextValue = expiryFilter.value === card.dataset.expiryFilter ? "" : card.dataset.expiryFilter;

      expiryFilter.value = nextValue;
      setActiveExpiryCard(nextValue);
      renderInventory();
      window.setTimeout(() => stopLoading("expiry-filter"), EXPIRY_FILTER_LOADING_MS);
    });
  });

  shopDashboard?.addEventListener("click", (event) => {
    const card = event.target.closest("[data-shop-filter]");

    if (!card) {
      return;
    }

    startLoading("shop-filter", "Đang lọc nhà thuốc");
    const shopFilterInput = document.querySelector('[data-filter="shop"]');
    const selectedShopCode = card.dataset.shopFilter;
    const nextShopCode = selectedShopCode && selectedShopCode === activeShopCode ? "" : selectedShopCode;

    if (shopFilterInput) {
      shopFilterInput.value = "";
    }

    applyShopFilter(nextShopCode);
    window.setTimeout(() => stopLoading("shop-filter"), EXPIRY_FILTER_LOADING_MS);
  });

  layoutModeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      startLoading("layout", "Đang đổi layout");
      setLayoutMode(button.dataset.layoutMode);
      window.setTimeout(() => stopLoading("layout"), 120);
    });
  });

  setLayoutMode(localStorage.getItem("upharma_layout_mode") || "left");

  if (localStorage.getItem("upharma_sidebar_collapsed") === "true") {
    appShell.classList.add("sidebar-collapsed");
  }

  sidebarToggleButtons.forEach((button) => {
    button.addEventListener("click", () => {
      appShell.classList.toggle("sidebar-collapsed");
      localStorage.setItem("upharma_sidebar_collapsed", appShell.classList.contains("sidebar-collapsed"));
    });
  });

  menuParentButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const menuGroup = button.closest(".menu-group");
      const isOpen = menuGroup.classList.toggle("is-open");

      button.setAttribute("aria-expanded", String(isOpen));
    });
  });

  n8nWorkflowLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      openN8nExample(link.dataset.n8nWorkflow);
    });
  });

  n8nExampleButtons.forEach((button) => {
    button.addEventListener("click", () => renderN8nExample(button.dataset.n8nExample));
  });

  document.querySelector("[data-close-n8n]")?.addEventListener("click", () => n8nDialog?.close());
  n8nDialog?.addEventListener("click", (event) => {
    if (event.target === n8nDialog) {
      n8nDialog.close();
    }
  });

  if (!API_CALLS_ENABLED) {
    loadStaticInventory();
    return;
  }

  startLoading("initial-load", "Đang tải hệ thống");

  try {
    await loadInventory();
  } catch (error) {
    console.error("Không thể khởi tạo trang tồn kho:", error);
  } finally {
    stopLoading("initial-load");
  }
}

initDashboard();
