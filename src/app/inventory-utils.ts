import { RawRecord } from "./upharma.service";

export type ExpiryStatus = "expired" | "danger" | "warning" | "safe" | "normal";

export const DAYS_PER_MONTH = 30;
export const UNDER_3_MONTHS_DAYS = 3 * DAYS_PER_MONTH;
export const UNDER_6_MONTHS_DAYS = 6 * DAYS_PER_MONTH;
export const UNDER_12_MONTHS_DAYS = 12 * DAYS_PER_MONTH;

export interface InventoryItem {
  rowKey: string;
  productName: string;
  productCode: string;
  shopCode: string;
  shopName: string;
  shop: string;
  price: unknown;
  priceText: string;
  stockValue: number;
  stockValueText: string;
  lot: string;
  expiry: unknown;
  expiryText: string;
  expiryStatus: ExpiryStatus;
  expiryDaysRemaining: number | null;
  quantity: unknown;
  unit: string;
  vat: unknown;
  searchText: string;
  columnSearchText: Record<string, string>;
  expanded: boolean;
}

export const PRODUCT_NAME_COLLATOR = new Intl.Collator("vi", { sensitivity: "base", numeric: true });

export function formatMoney(value: unknown): string {
  const number = parseNumericValue(value);

  if (!Number.isFinite(number)) {
    return String(value ?? "");
  }

  return new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: 0,
  }).format(number);
}

export function parseNumericValue(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (value === null || value === undefined) {
    return 0;
  }

  const text = String(value).trim();
  if (!text) {
    return 0;
  }

  const normalized = text
    .replace(/\s+/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");

  const parsed = Number(normalized);
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  const fallback = Number(text.replace(/[^\d-]/g, ""));
  return Number.isFinite(fallback) ? fallback : 0;
}

export function normalizeFilterText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeInventoryRow(row: RawRecord, rowIndex = 0): InventoryItem {
  const productName = String(
    pick(row, [
      "ProductName",
      "Product_Name",
      "ProductFullName",
      "Product_Name_Full",
      "TenSP",
      "TenSanPham",
      "Name",
      "ItemName",
    ]),
  ).trim();
  const expiry = pick(
    row,
    [
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
    ],
    pickByKeywords(row, ["exp", "expire", "expiry", "handung", "hsd", "hethan"], [
      "create",
      "update",
      "import",
      "input",
    ]),
  );
  const unit = String(
    pick(
      row,
      [
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
      ],
      pickByKeywords(row, ["unit", "uom", "donvi", "dvt"], ["price", "quantity", "qty"]),
    ),
  );
  const productCode = String(pick(row, ["ProductCode", "ProductID", "Product_ID", "MaSP", "MaSanPham", "ItemCode", "Code"]));
  const shopCode = String(row["__shopCode"] || row["ShopCode"] || "");
  const shopName = String(row["__shopName"] || shopCode);
  const price = pick(row, ["Price", "Gia", "GiaBan", "SalePrice", "RetailPrice", "UnitPrice", "PriceVAT", "PriceSell"]);
  const lot = String(pick(row, ["LotCode", "LotNo", "Lo", "SoLo", "BatchNo", "BatchCode"]));
  const quantity = pick(row, ["Quantity", "Qty", "SL", "SoLuong", "InventoryQuantity", "StockQty", "TonKho", "RemainQty"]);
  const vat = pick(row, ["VAT", "Vat", "VATRate", "Tax"]);
  const priceValue = parseNumericValue(price);
  const quantityValue = parseNumericValue(quantity);
  const stockValue = priceValue * quantityValue;
  const priceText = formatMoney(price);
  const stockValueText = formatMoney(stockValue);
  const expiryText = formatInventoryDate(expiry);
  const expiryDaysRemaining = getExpiryDaysRemaining(expiry);
  const expiryStatus = expiryClass(expiry);
  const item = {
    rowKey: [
      productCode,
      shopCode,
      lot,
      expiryText,
      rowIndex,
    ].join("|"),
    productName,
    productCode,
    shopCode,
    shopName,
    shop: shopCode,
    price,
    priceText,
    stockValue,
    stockValueText,
    lot,
    expiry,
    expiryText,
    expiryStatus,
    expiryDaysRemaining,
    quantity,
    unit,
    vat,
    searchText: "",
    columnSearchText: {},
    expanded: false,
  };

  item.columnSearchText = {
    productName: normalizeFilterText(item.productName),
    productCode: normalizeFilterText(item.productCode),
    shop: normalizeFilterText(`${item.shopCode} ${item.shopName}`),
    price: normalizeFilterText(`${item.price ?? ""} ${item.priceText}`),
    lot: normalizeFilterText(item.lot),
    expiryStatus: normalizeFilterText(item.expiryStatus),
    quantity: normalizeFilterText(item.quantity),
    unit: normalizeFilterText(item.unit),
    vat: normalizeFilterText(item.vat),
  };
  item.searchText = normalizeFilterText(
    [
      item.productName,
      item.productCode,
      item.shopCode,
      item.shopName,
      item.price,
      item.priceText,
      item.stockValue,
      item.stockValueText,
      item.lot,
      item.expiryText,
      item.quantity,
      item.unit,
      item.vat,
      item.expiryStatus,
    ].join(" "),
  );

  return item;
}

export function compareInventoryItems(firstItem: InventoryItem, secondItem: InventoryItem): number {
  return (
    compareProductNames(firstItem.productName, secondItem.productName) ||
    PRODUCT_NAME_COLLATOR.compare(firstItem.shopCode, secondItem.shopCode)
  );
}

export function getColumnSearchText(item: InventoryItem, key: string): string {
  const cachedText = item.columnSearchText[key];

  if (cachedText !== undefined) {
    return cachedText;
  }

  if (key === "price") {
    return normalizeFilterText(`${item.price ?? ""} ${item.priceText}`);
  }

  if (key === "shop") {
    return normalizeFilterText(`${item.shopCode} ${item.shopName}`);
  }

  return normalizeFilterText(item[key as keyof InventoryItem] ?? "");
}

function compareProductNames(firstName: string, secondName: string): number {
  const firstStartsWithLetter = /^\p{L}/u.test(String(firstName).trim());
  const secondStartsWithLetter = /^\p{L}/u.test(String(secondName).trim());

  if (firstStartsWithLetter !== secondStartsWithLetter) {
    return firstStartsWithLetter ? -1 : 1;
  }

  return PRODUCT_NAME_COLLATOR.compare(firstName, secondName);
}

function pick(row: RawRecord, keys: string[], fallback: unknown = ""): unknown {
  const normalizedMap = new Map(
    Object.keys(row || {}).map((key) => [key.toLowerCase().replaceAll("_", ""), key]),
  );

  for (const key of keys) {
    const directValue = row[key];

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

function pickByKeywords(row: RawRecord, includeKeywords: string[], excludeKeywords: string[] = []): unknown {
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

function parseDate(value: unknown): Date | null {
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

export function getExpiryDaysRemaining(value: unknown): number | null {
  const date = parseDate(value);

  if (!date) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(date);
  expiry.setHours(0, 0, 0, 0);

  return Math.floor((expiry.getTime() - today.getTime()) / 86400000);
}

function formatInventoryDate(value: unknown): string {
  const date = parseDate(value);

  if (!date) {
    return String(value ?? "");
  }

  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
    .format(date)
    .replaceAll("/", "-");
}

function expiryClass(value: unknown): ExpiryStatus {
  const diffDays = getExpiryDaysRemaining(value);

  if (diffDays === null) {
    return "normal";
  }

  if (diffDays < 0) {
    return "expired";
  }

  if (diffDays <= UNDER_3_MONTHS_DAYS) {
    return "danger";
  }

  if (diffDays <= UNDER_6_MONTHS_DAYS) {
    return "warning";
  }

  if (diffDays <= UNDER_12_MONTHS_DAYS) {
    return "safe";
  }

  return "normal";
}
