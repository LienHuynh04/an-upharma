# KẾ HOẠCH TỐI ƯU HIỆU NĂNG VÀ TÁCH SHARED MODULES (PERFORMANCE & ARCHITECTURE PLAN)

---

## I. TỔNG QUAN VẤN ĐỀ VÀ PHÂN TÍCH 3 LỚP ĐIỂM NGHẼN SOURCE CODE

Dù Firebase đã giúp khắc phục độ trễ mạng (Network Latency), **mã nguồn Angular (Source Code)** vẫn bị chậm, lag và giật giao diện do 3 lớp điểm nghẽn hiệu năng trên máy Client:

---

### LỚP 1: THUẬT TOÁN XỬ LÝ NẶNG $O(n \times \text{shop})$ VÀ $O(n^2)$
- **`upharma.service.ts`**: Hàm `fetchResourceFromApi()` luôn duyệt qua toàn bộ danh sách `this.shopList`, mỗi shop gọi API rồi dùng `extractArray()` đệ quy/duyệt sâu object, sau đó thực hiện `map`, `filter`, `Object.values`, `queue.push(...)`.
- **`layout.component.ts`**: Khi tạo báo cáo, ứng dụng tải đồng thời `employeePlans`, `shopPlans`, `inventory`, `orders`, sau đó `filter`/`map` trên mảng khổng lồ và nối chuỗi HTML báo cáo đồ sộ trên browser.

---

### LỚP 2: ÁP LỰC BỘ NHỚ VÀ RÒ RỈ RAM (MEMORY CHURN & GC PRESSURE)
- Trong các component như [`inventory-new.component.ts`](file:///Users/lienha/Documents/Codex/An%20kh%C3%B9ng/src/app/inventory-new/inventory-new.component.ts) và [`out-of-stock.component.ts`](file:///Users/lienha/Documents/Codex/An%20kh%C3%B9ng/src/app/out-of-stock/out-of-stock.component.ts):
  - Lạm dụng việc lặp lại liên tục `.map().filter().reduce()` trên cùng một tập dữ liệu.
  - Tạo mới liên tục các đối tượng `new Set(...)`, `new Map(...)` trong các hàm Getter trên mỗi khung hình render.
  - **Nhân bản đối tượng dư thừa bằng toán tử Spread**:
    ```typescript
    { ...item, __shopCode: shop.ShopCode }
    { ...row, __shopCode: shopCode }
    ```
  - **Hậu quả**: Trình duyệt phải gọi trình thu gom rác (Garbage Collector - GC) liên tục làm khựng UI, giật lag giao diện.

---

### LỚP 3: XỬ LÝ TOÀN BỘ SHOP THAY VÌ CHỈ XỬ LÝ SHOP ĐANG CHỌN (`activeShopCode`)
- **`dashboard.component.ts`**: Người dùng chọn xem 1 shop duy nhất, nhưng hệ thống vẫn xử lý dữ liệu và cache lớn của mọi shop.
- **`upharma.service.ts`**: Hàm `fetchResource()` tải dữ liệu của toàn bộ shop nếu không truyền tham số filter.
- **`layout.component.ts`**: Tạo báo cáo cho tất cả nhà thuốc cùng một lúc thay vì theo nhu cầu.

---

## II. GIẢI PHÁP TỐI ƯU NGUỒN (SOURCE CODE OPTIMIZATION STRATEGY)

### 💡 QUY TẮC 1: Ưu tiên tuyệt đối cho Shop đang Active (`activeShopCode`)
- Mọi component chỉ truyền tham số `options.shopCodes = [activeShopCode]` khi yêu cầu dữ liệu.
- Không bao giờ tải hoặc tính toán dữ liệu của Shop B/C/D khi người dùng chỉ đang xem Shop A.

---

### 💡 QUY TẮC 2: Gộp vòng lặp (Single-Pass Array Processing)
Thay vì xâu chuỗi nhiều hàm `.filter().map().filter()` lặp lại dữ liệu nhiều lần:

##### ❌ Trước khi tối ưu (Chạy lặp mảng 3 lần):
```typescript
const result = data
  .filter(item => item.quantity > 0)
  .map(item => ({ ...item, priceText: formatMoney(item.price) }))
  .filter(item => item.priceText !== '0');
```

##### ✅ Sau khi tối ưu (Gộp thành 1 vòng lặp `for` duy nhất - Nhanh gấp 3 lần):
```typescript
const result = [];
for (let i = 0; i < data.length; i++) {
  const item = data[i];
  if (item.quantity > 0) {
    const priceText = formatMoney(item.price);
    if (priceText !== '0') {
      result.push({ ...item, priceText });
    }
  }
}
```

---

### 💡 QUY TẮC 3: Loại bỏ Clone Object bằng toán tử Spread `{ ...item }`
- Không clone object dư thừa khi không cần biến đổi dữ liệu.
- Gán trực tiếp thuộc tính hoặc dùng tham chiếu object (Reference) để giảm tải cho Garbage Collector (GC).

---

### 💡 QUY TẮC 4: Tách biệt Tầng Dữ Liệu (Data Layer) và Tầng Giao Diện (Presentation)
- **Service**: Chịu trách nhiệm fetch dữ liệu và chuẩn hóa 1 lần duy nhất (`normalize`).
- **Component**: Chỉ nhận dữ liệu đã chuẩn hóa để render ra HTML. Không thực hiện tính toán `filter/group/format` lại ở Component.

---

## III. THIẾT KẾ CẤU TRÚC REFACTORING SHARED (SERVICES & COMPONENTS)

Để loại bỏ hơn 2.000 dòng code trùng lặp và làm gọn bộ mã nguồn, các phần code bị phân tán sẽ được tổ chức lại theo cấu trúc thư mục Shared chuẩn Angular:

### 📁 Cấu trúc Thư mục `src/app/shared/`:

```text
src/app/shared/
├── components/
│   ├── shop-tabs/            # Component Thanh chọn nhà thuốc (Shop Selector Tabs)
│   ├── kpi-summary-cards/    # Component Thẻ thống kê chỉ số KPI (All, Danger, Warning...)
│   ├── table-pagination/     # Component Phân trang bảng dữ liệu (Pagination Footer)
│   └── modal-dialog/         # Component Khung cửa sổ Popup (Modal Dialog Container)
├── services/
│   ├── excel-export.service.ts # Dịch vụ xuất file Excel (Tập trung thư viện xlsx)
│   └── filter-state.service.ts # Dịch vụ quản lý & đồng bộ bộ lọc giữa các trang
└── utils/
    └── inventory-utils.ts    # Các hàm chuẩn hóa dữ liệu & format tiền tệ, ngày tháng
```

---

### 🛠️ DANH SÁCH CHI TIẾT CÁC PHẦN TÁCH SHARED:

#### 1. `ExcelExportService` (`src/app/shared/services/excel-export.service.ts`)
- **Tình trạng**: Đoạn mã khởi tạo `import('xlsx')`, `book_new()`, `json_to_sheet()`, `write()` và tải Blob đang bị **trùng lặp ở 7 Component**:
  - `fefo.component.ts` (dòng 573)
  - `key-products.component.ts` (dòng 237)
  - `slow-selling.component.ts` (dòng 215)
  - `transfer-suggestions.component.ts` (dòng 1063 & 1092)
  - `out-of-stock.component.ts` (dòng 299)
  - `stable-consumption.component.ts` (dòng 232)
  - `inventory-new.component.ts`
- **Giải pháp**: Tách thành Service dùng chung duy nhất `ExcelExportService.exportJsonToExcel(data, fileName, sheetName)`.

#### 2. Component `<app-shop-tabs>` (`src/app/shared/components/shop-tabs/`)
- **Tình trạng**: Giao diện thanh Tab chọn Nhà thuốc cùng logic `trackByShop` bị lặp lại HTML ở **6 màn hình**: `key-products`, `slow-selling`, `out-of-stock`, `stable-consumption`, `inventory-new`, `fefo`.
- **Giải pháp**: Tách thành Shared Component tái sử dụng ở mọi trang.

#### 3. Component `<app-kpi-summary-cards>` (`src/app/shared/components/kpi-summary-cards/`)
- **Tình trạng**: Cấu trúc HTML thẻ thống kê 5 mức hạn dùng ("Tất cả", "Hết hạn", "3 Tháng", "6 Tháng", "1 Năm") bị lặp lại ở `inventory-new`, `fefo` và `transfer-suggestions`.
- **Giải pháp**: Tách thành Shared Component nhận mảng chỉ số `kpiCards` đầu vào.

#### 4. Component `<app-table-pagination>` (`src/app/shared/components/table-pagination/`)
- **Tình trạng**: Thanh phân trang chân bảng (`Trang trước`, `Trang sau`, `Hiển thị 1 - 50`) trùng lặp ở các bảng dữ liệu.
- **Giải pháp**: Tách thành Shared Component phân trang dùng chung.

---

## IV. BẢNG ĐỐI CHIẾU 3 FILE CẦN TỐI ƯU HOT NHẤT

| File cần tối ưu | Điểm nghẽn hiện tại | Giải pháp áp dụng |
| :--- | :--- | :--- |
| **`upharma.service.ts`** | Tải toàn bộ shop trong `this.shopList`, lặp `extractArray()` phức tạp. | Giới hạn chỉ fetch cho `activeShopCode`, dùng `Set/Map` tra cứu thay cho `filter`. |
| **`dashboard.component.ts`** | Tải dữ liệu báo cáo tất cả shop. | Chỉ fetch `CustomerNew` và `Statistics` cho `activeShopCode` duy nhất. |
| **`layout.component.ts`** | Nối chuỗi HTML báo cáo lớn của mọi shop cùng lúc. | Tách nhỏ báo cáo theo shop đang chọn, render theo nhu cầu (On-Demand). |

---

## V. KẾT LUẬN
- **Firebase**: Giải quyết độ trễ đường truyền mạng (Network Latency).
- **Source Optimization**: Giải quyết giật lag CPU, tiêu tốn RAM và đơ giao diện UI.
- **Shared Architecture**: Giảm 2.000 dòng code lặp, giúp ứng dụng sạch sẽ, dễ bảo trì và mở rộng lâu dài.
