# Hướng Dẫn Kỹ Thuật: Cấu Trúc Dữ Liệu & Cách Xử Lý Lọc Trên Từng Trang Web

Tài liệu này mô tả chi tiết cách từng trang (Route Component) trong website Upharma lấy dữ liệu từ Firebase, chuẩn hóa trường thông tin, thực hiện bộ lọc và tối ưu hóa hiển thị.

---

## 📌 Kiến Trúc Chung
1. **Chế độ dữ liệu đệm (Static Cache)**:
   * Khi bật `useStaticData: true` và có `firebaseDbUrl`, các trang sẽ lấy dữ liệu từ Firebase Realtime Database thông qua REST API (sử dụng lệnh `fetch` cơ bản ở máy khách).
2. **Che giấu PII**:
   * Toàn bộ dữ liệu nhạy cảm của khách hàng/nhân viên đã được che/ẩn danh ở Server trước khi đẩy lên Firebase.
3. **Hiệu năng hiển thị**:
   * Mọi trang đều áp dụng cơ chế cuộn vô tận (**Infinite Scroll**) hoặc phân trang ảo: Chỉ hiển thị `visibleLimit` dòng đầu tiên (thường là 50-100 dòng), cuộn xuống dưới cùng để nạp thêm nhằm tránh giật đơ giao diện.

---

## 🗺️ Chi Tiết Từng Trang (Page Route)

### 1. Báo cáo Tồn Kho (`/ton-kho`)
* **Component**: [InventoryNewComponent](file:///Users/lienha/Documents/Codex/An%20khu%CC%80ng/src/app/inventory-new/inventory-new.component.ts)
* **Nguồn dữ liệu (Firebase)**: 
  * Đường dẫn: `${firebaseDbUrl}/shops/${shopCode}/upharma_data/inventory.json`
* **Cơ chế tải dữ liệu**:
  * Tải đồng thời dữ liệu tồn kho của tất cả các nhà thuốc được phân quyền (`shopsToFetch`), sau đó gộp chung thành một mảng `this.normalizedRows`.
* **Bộ lọc dữ liệu (Filter Logic)**:
  * **Lọc theo nhà thuốc (`activeShopCode`)**: Chỉ giữ lại các dòng có `item.shopCode === activeShopCode`.
  * **Chống giật lag (Debounce)**: Sử dụng hàm `queueFilter(delay = 200ms)`. Khi người dùng gõ vào ô tìm kiếm, hệ thống đợi ngắt phím rồi mới gọi hàm lọc `recomputeFilteredRows()`.
  * **Lọc hạn sử dụng (`expiryStatus`)**:
    * `expired`: Hạn dùng đã qua ngày hiện tại.
    * `danger`: Hạn dùng còn ≤ 90 ngày.
    * `warning`: Hạn dùng từ 91 - 180 ngày.
    * `safe`: Hạn dùng > 180 ngày.
  * **Tìm kiếm theo cột**: So khớp văn bản không dấu (`normalizeFilterText`) trên các trường: Tên thuốc (`productName`), mã thuốc (`productCode`), hoạt chất (`activeIngredient`), nhóm hàng (`categoryName`).
* **Hiển thị & Thống kê**:
  * Tổng giá trị tồn kho: Cộng dồn trường `stockValue` (Số lượng tồn × Đơn giá).
  * Tổng số mặt hàng độc bản: Đếm số lượng mã thuốc (`productCode`) khác nhau bằng `Set`.

---

### 2. Hàng Bán Chậm (`/hang-ban-cham`)
* **Component**: [SlowSellingComponent](file:///Users/lienha/Documents/Codex/An%20khu%CC%80ng/src/app/slow-selling/slow-selling.component.ts)
* **Nguồn dữ liệu (Firebase)**:
  * Đường dẫn: `${firebaseDbUrl}/shops/${shopCode}/upharma_data/sales_speed.json`
* **Cơ chế tải dữ liệu**:
  * Gọi API `GetReportSalesSpeed` để lấy dữ liệu tốc độ bán hàng của các thuốc trong vòng 3 tháng qua.
* **Bộ lọc dữ liệu (Filter Logic)**:
  * Được kích hoạt tự động qua Getter `get filteredRows()`.
  * Lọc theo nhà thuốc đang chọn (`row.shopCode === this.activeShopCode`).
  * Hàm `matchesColumnFilters(row)` duyệt qua danh sách tìm kiếm văn bản không dấu của:
    * Tên sản phẩm (`productName`)
    * Mã sản phẩm (`productCode`)
* **Hiển thị & Thống kê**:
  * Hiển thị bảng danh sách các thuốc có tốc độ bán thấp, số lượng bán ra ít trong chu kỳ 30/60/90 ngày.
  * Hỗ trợ lazy load tăng dần `visibleLimit` khi cuộn chuột.

---

### 3. Hàng Đã Hết / Sắp Hết (`/hang-da-het` hoặc `/out-of-stock`)
* **Component**: [OutOfStockComponent](file:///Users/lienha/Documents/Codex/An%20khu%CC%80ng/src/app/out-of-stock/out-of-stock.component.ts)
* **Nguồn dữ liệu (Firebase)**:
  * Đường dẫn: `${firebaseDbUrl}/shops/${shopCode}/upharma_data/orders.json` và `invoices.json`
* **Cơ chế tải dữ liệu**:
  * Gộp thông tin đơn đặt hàng từ nhà cung cấp và hóa đơn bán hàng để tính toán lượng hàng thiếu hụt.
* **Bộ lọc dữ liệu (Filter Logic)**:
  * Hàm lọc Getter `get filteredRows()` tự động quét:
    * Lọc theo nhà thuốc (`shopCode`).
    * Lọc theo trạng thái thiếu hàng (Hết hẳn tồn kho tại quầy nhưng vẫn có nhu cầu mua của khách).
    * So khớp từ khóa không dấu tên thuốc/mã thuốc.

---

### 4. Hàng Lập Tốt / Tiêu Thụ Ổn Định (`/hang-lap-tot`)
* **Component**: [StableConsumptionComponent](file:///Users/lienha/Documents/Codex/An%20khu%CC%80ng/src/app/stable-consumption/stable-consumption.component.ts)
* **Nguồn dữ liệu (Firebase)**:
  * Đường dẫn: `${firebaseDbUrl}/shops/${shopCode}/upharma_data/statistics_shop.json`
* **Cơ chế tải dữ liệu**:
  * Lấy dữ liệu thống kê tiêu thụ ổn định của shop trong chu kỳ tháng hiện tại.
* **Bộ lọc dữ liệu (Filter Logic)**:
  * Sử dụng thuộc tính `get filteredRows()` lọc nhanh theo nhà thuốc đang hoạt động.
  * Lọc tìm kiếm sản phẩm tiêu thụ tốt dựa trên tần suất hóa đơn và số lượng bán đều đặn mỗi tuần.

---

### 5. Gợi Ý Chuyển Hàng Nội Bộ (`/goi-y-chuyen-hang`)
* **Component**: [TransferSuggestionsComponent](file:///Users/lienha/Documents/Codex/An%20khu%CC%80ng/src/app/transfer-suggestions/transfer-suggestions.component.ts)
* **Nguồn dữ liệu (Firebase)**:
  * Đường dẫn: `${firebaseDbUrl}/national_inventory_cache.json` và cache cục bộ IndexedDB `inventory`.
* **Cơ chế tải dữ liệu**:
  * Kết hợp kiểm tra tồn kho tại chỗ (local shop) và tồn kho toàn quốc lấy từ Firebase Cache để đưa ra gợi ý chuyển hàng giữa các quầy.
* **Quy trình xử lý dữ liệu gợi ý**:
  1. Lấy danh sách thuốc hết hàng/bán chạy của shop A.
  2. Tra cứu trên Firebase Cache xem shop B, C, D nào có lượng tồn dư thừa lớn (lượng tồn kho > định mức cảnh báo an toàn).
  3. Tính toán khoảng cách hoặc ưu tiên điều chuyển nội bộ và render ra danh sách gợi ý dạng: *Cần chuyển X hộp thuốc Y từ Shop B sang Shop A*.
* **Xóa cache**:
  * Cung cấp nút nhấn **"Xóa cache Firebase"** gọi hàm `firebaseInventoryService.clearAllCache()` gửi phương thức HTTP `DELETE` lên Firebase để xóa sạch bộ đệm tồn kho toàn quốc và bắt đầu đồng bộ mới từ đầu.

---

### 6. Chỉ Tiêu Nhân Viên (`/chi-tieu-nhan-vien`)
* **Component**: [EmployeePlanComponent](file:///Users/lienha/Documents/Codex/An%20khu%CC%80ng/src/app/employee-plan/employee-plan.component.ts)
* **Nguồn dữ liệu (Firebase)**:
  * Đường dẫn: `${firebaseDbUrl}/shops/${shopCode}/upharma_data/employees.json`
* **Cơ chế hiển thị & Lọc**:
  * Lọc danh sách nhân viên của shop được chọn.
  * Hiển thị bảng tiến độ hoàn thành doanh số (KPI/OKR) của từng nhân sự dưới dạng thanh tiến trình (progress bar) màu sắc sinh động (xanh lá: đạt, vàng: sắp đạt, đỏ: chậm tiến độ).

---

### 7. Trang Đăng Nhập (`/login`)
* **Component**: [LoginComponent](file:///Users/lienha/Documents/Codex/An%20khu%CC%80ng/src/app/login/login.component.ts)
* **Cơ chế xử lý**:
  * Khi nhấn đăng nhập, gọi hàm `login()` của `UpharmaService`.
  * Nếu bật proxy (`useBackendProxy: true`), gọi endpoint `/api/login` trên Node.js backend.
  * Nếu tắt proxy, gửi request trực tiếp đến API nguồn để xác thực số điện thoại và lấy Token cùng danh sách nhà thuốc được phân quyền (`ShopLst`).

---

## 🛠️ Quy Trình Gỡ Lỗi & Thêm Bộ Lọc Mới
Nếu bạn muốn thêm bất kỳ bộ lọc mới nào vào một trang (ví dụ: Trang tồn kho):
1. **Khai báo bộ lọc**: Thêm key và giá trị mặc định vào đối tượng `this.columnFilters` ở phần khai báo thuộc tính.
2. **Gắn sự kiện (HTML)**: Thêm thẻ `<input>` hoặc `<select>` vào giao diện, sử dụng liên kết dữ liệu hai chiều `[(ngModel)]="columnFilters.ten_bo_loc"` và gọi hàm `onColumnFilterInput('ten_bo_loc')`.
3. **Cập nhật logic lọc**: Cập nhật hàm `recomputeFilteredRows()` để duyệt thêm điều kiện lọc mới của bạn.
