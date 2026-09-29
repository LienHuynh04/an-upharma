# Kế hoạch tối ưu hiệu suất hệ thống UPHARMA

## 1. Tóm tắt vấn đề

Nguồn chậm hiện tại không phải do Angular build bị lỗi, mà là do ứng dụng đang tải quá nhiều dữ liệu từ API bên thứ ba trong thời gian ngắn, và mỗi màn hình lại thực hiện nhiều request lặp lại trên toàn bộ danh sách shop.

Điểm nổi bật trong code hiện tại:

- [src/app/upharma.service.ts](src/app/upharma.service.ts): `fetchResourceFromApi()` duyệt toàn bộ `this.shopList` rồi gọi API cho từng shop.
- [src/app/login/login.component.ts](src/app/login/login.component.ts): sau login gọi `prefetchSalesSpeed()` ngay.
- [src/app/dashboard/dashboard.component.ts](src/app/dashboard/dashboard.component.ts): mỗi lượt load dashboard gọi 2 endpoint nặng.
- [src/app/layout/layout.component.ts](src/app/layout/layout.component.ts): fetch đồng thời nhiều dataset phục vụ báo cáo/report.

Đây là nguyên nhân chính khiến UI bị lag, bị treo, hoặc chờ quá lâu khi mở màn hình.

---

## 2. Nguyên nhân root cause

### 2.1 API bên thứ ba không thể thay đổi

Do API đến từ nhà cung cấp ngoài, không thể yêu cầu tối ưu lại endpoint hoặc tăng tốc máy chủ. Vì vậy cách giải quyết hợp lý là:

- không gọi API gốc mỗi khi render màn hình,
- dùng Firebase như layer cache/precomputed,
- chỉ refresh dữ liệu khi đã quá hạn hoặc cần cập nhật nền.

### 2.2 Dữ liệu được tải theo kiểu “toàn bộ shop” thay vì “shop đang chọn”

Trong [src/app/upharma.service.ts](src/app/upharma.service.ts), logic `fetchResource()` và `fetchResourceFromApi()` đang luôn lặp qua mọi shop trong `this.shopList`.

Với nhiều shop, số lượng request sẽ tăng theo cấp số nhân:

- 5 resource chính
- mỗi resource xử lý 20–50 shop
- mỗi shop có thể trả về hàng nghìn dòng dữ liệu

Kết quả là:

- network chậm,
- browser phải parse JSON rất lớn,
- RAM và CPU tăng, render UI lag.

### 2.3 Có nhiều endpoint nặng được gọi ngay khi login hoặc khởi tạo dashboard

Ví dụ:

- `GetReportSalesSpeed`
- `GetStatisticsShop`
- `GetCustomerNewLst`
- `GetInventoryShop`
- `GetOrderHeaderByShop`
- `GetEmployeeOfShop`

Những endpoint này không nên được gọi đồng thời với số lượng lớn như hiện tại. Cần giới hạn thời điểm gọi và chỉ fetch với shop / range phù hợp.

---

## 3. Vì sao Firebase vẫn chưa giải quyết triệt để

Firebase đang được dùng ở mức cơ bản, nhưng hiện tại hệ thống còn đang chỉ "có sẵn một số cache" chứ chưa có mô hình “Firebase là nguồn dữ liệu chính”.

Tức là:

- cronjob có thể ghi dữ liệu vào Firebase,
- nhưng app vẫn còn gọi API gốc ở nhiều chỗ,
- hoặc fetch nhiều shop cùng lúc dù dữ liệu đã có sẵn trên Firebase.

Nói ngắn gọn: Firebase đang là optional cache, chưa phải là source of truth.

---

## 4. Hướng giải quyết đúng đắn

### Mục tiêu

Tối ưu UX bằng cách:

1. Không chờ API gốc nếu dữ liệu đã có trong Firebase.
2. Chỉ tải dữ liệu cần thiết cho shop/current view.
3. Tách dữ liệu thành từng resource theo shop.
4. Refresh dữ liệu nền thay vì block UI.

### Cấu trúc đề xuất

#### A. Firebase là cache/precomputed DB

Cronjob lấy dữ liệu từ UPHARMA và nén/thêm vào Firebase theo mẫu:

```text
/shops/{shopCode}/upharma_data/{resourceName}.json
```

Ví dụ:

```text
/shops/SHOP001/upharma_data/inventory.json
/shops/SHOP001/upharma_data/orders.json
/shops/SHOP001/upharma_data/dashboard_statistics.json
```

#### B. App đọc Firebase trước

Khi component cần dữ liệu:

- nếu JSON trong Firebase còn mới: dùng ngay
- nếu JSON cũ hoặc thiếu: gọi API gốc ở background
- nếu có dữ liệu mới, replace vào cache

#### C. Chỉ lấy dữ liệu cần thiết

- dashboard: chỉ lấy shop đang active
- report: chỉ lấy shop đang chọn hoặc range date đang filter
- inventory: không load tất cả shop nếu đang xem một shop

---

## 5. Phương án triển khai cụ thể

### Bước 1: Xác định các resource cần cache

Tập trung ưu tiên cho các dữ liệu nặng nhất:

- inventory
- invoices
- orders
- employees
- dashboard_statistics
- dashboard_customers
- sales_report
- key_products
- slow_selling
- stable_consumption
- out_of_stock

### Bước 2: Tạo policy cache rõ ràng

Ví dụ:

- `inventory`: TTL 5 phút
- `dashboard_statistics`: TTL 10 phút
- `sales_report`: TTL 15 phút
- `orders`: TTL 5 phút

Nếu dữ liệu quá cũ thì refresh nền, không chặn UI.

### Bước 3: Chuyển logic đọc dữ liệu về Firebase-first

Trong [src/app/upharma.service.ts](src/app/upharma.service.ts), ưu tiên:

1. Check Firebase cache
2. Nếu có và còn mới → return
3. Nếu không có → fetch từ API gốc
4. Lưu cache và trả dữ liệu cho UI

### Bước 4: Giới hạn concurrency và batch size

Thay vì chạy toàn bộ shop cùng lúc, cần giới hạn:

- max 2–4 shop/luồng trong lúc load dữ liệu nền
- hoặc load theo shop active trước
- chỉ fetch batch lớn khi thật sự cần

### Bước 5: Tách dữ liệu theo màn hình

Không để một service chung load mọi resource khi người dùng chỉ xem dashboard. Cách tốt hơn:

- dashboard service: chỉ load dashboard data
- inventory service: chỉ load inventory cho shop đang active
- report service: chỉ load dữ liệu report chọn lọc

### Bước 6: Khởi tạo ứng dụng nhẹ hơn

Xóa hoặc giảm các fetch không cần thiết ở login:

- `prefetchSalesSpeed()` nên chỉ chạy sau khi người dùng đã vào dashboard hoặc khi idle
- không prefetch các dataset nặng ngay khi đăng nhập nếu chưa cần

---

## 6. Giải pháp thiết thực theo từng component

### Dashboard

Trong [src/app/dashboard/dashboard.component.ts](src/app/dashboard/dashboard.component.ts):

- chỉ fetch cho `activeShopCode`
- ưu tiên tài liệu từ Firebase `dashboard_statistics` / `dashboard_customers`
- nếu thiếu, mới gọi API gốc với range date hiện tại

### Login

Trong [src/app/login/login.component.ts](src/app/login/login.component.ts):

- sau login, không nên trigger quá nhiều prefetch nặng ngay
- chuyển `prefetchSalesSpeed()` thành background task có độ ưu tiên thấp

### Layout / report

Trong [src/app/layout/layout.component.ts](src/app/layout/layout.component.ts):

- không fetch đồng thời tất cả shop và tất cả resource khi mở report
- chỉ load các dữ liệu mà cần để build báo cáo hiện tại

### Service chung

Trong [src/app/upharma.service.ts](src/app/upharma.service.ts):

- yêu cầu `callEndpoint()` ưu tiên Firebase khi endpoint có cache
- rút gọn `fetchResourceFromApi()` để không loop toàn bộ shop nếu `shopCodes` hoặc shop đang active chỉ có 1–2 shop

---

## 7. Kế hoạch ưu tiên triển khai

### Ưu tiên 1: Fix ngay

- Chỉ load các resource cho shop đang active
- Kiểm tra lại `prefetchSalesSpeed()`
- Bỏ hoặc hạ ưu tiên các call nặng trong login

### Ưu tiên 2: Chuyển phần nặng sang Firebase-first

- map `dashboard_statistics` và `dashboard_customers` sang Firebase
- map `inventory` và `orders` sang Firebase

### Ưu tiên 3: Tối ưu UI

- lazy load theo tab/page
- tránh fetch khi user chưa mở screen đó
- thêm loading skeleton rõ ràng để UX không bị cảm giác “treo”

---

## 8. Đánh giá kỹ thuật source hiện tại về performance

### 8.1. Dùng `ChangeDetectionStrategy.OnPush`

Hiện tại source chưa sử dụng `OnPush` ở hầu hết component. Vì vậy Angular sẽ chạy change detection nhiều lần hơn mức cần thiết khi state thay đổi, nhất là với các component render danh sách lớn hoặc có nhiều dữ liệu thống kê.

Khi áp dụng, ưu tiên cho các component dữ liệu lớn như:

- dashboard
- inventory-new
- out-of-stock
- key-products
- stable-consumption
- slow-selling
- transfer-suggestions

### 8.2. Dùng `trackBy` trong `*ngFor`

Đây là điểm đã có cải thiện ở một số component, nhưng chưa đồng bộ toàn bộ app. Cần kiểm tra các template còn lại để bổ sung `trackBy` cho những danh sách render hàng trăm/ hàng nghìn dòng.

Ưu tiên cho:

- list shop tabs
- list sản phẩm
- list row tồn kho
- list kỳ vọng / gợi ý điều chuyển

### 8.3. Tách tác vụ nặng ra khỏi Angular Zone

Không thấy `NgZone.runOutsideAngular` trong source. Điều này có nghĩa app đang để các tác vụ nặng chạy trong Angular zone, làm trigger change detection quá nhiều. Nếu cần xử lý dữ liệu nặng, cần tách phần xử lý lớn ra ngoài Angular zone để giảm tốn CPU và render.

### 8.4. Tránh gọi hàm trong template

Nhiều template đang gọi hàm trực tiếp như `formatMoney()`, `getPaymentTotal()`, `getInventoryValueLabel()`, ... Angular sẽ gọi lại hàm mỗi cycle change detection. Với data lớn, đây tạo thêm overhead đáng kể.

Cần chuyển các tính toán thường xuyên thành:

- computed property / getter có điều kiện rõ ràng,
- hoặc map/normalize trước khi render,
- hoặc dùng `memoized`/`cached` cho các value ổn định.

### 8.5. Lazy Loading và Preloading

Project đã có lazy loading cho route `cronjob`, nhưng chưa tận dụng triệt để cho các route chính. Cần cân nhắc:

- lazy load các màn hình nặng như inventory, report, transfer-suggestions, out-of-stock khi người dùng đến đó
- bổ sung preloading nhẹ cho các route thường xuyên truy cập như dashboard, inventory, report

### 8.6. Tree Shaking và tối ưu import

Có dynamic import `xlsx`, đây là cách tốt. Nhưng source vẫn còn nhiều import tĩnh nặng có thể làm tăng bundle. Nên:

- import các thư viện nặng theo kiểu lazy/dynamic khi cần
- kiểm tra import thừa trong các component
- ưu tiên dùng `import type` cho type-only usage nếu TypeScript cho phép

### 8.7. Cleanup Observable và memory leak

Hiện tại app ít dùng RxJS trực tiếp nên nguy cơ leak không quá cao, nhưng cần chú ý khi triển khai thêm observable / subscription. Dùng `takeUntil`, `DestroyRef`, hoặc `AsyncPipe` để tránh memory leak và tránh CD chạy quá nhiều.

### 8.8. Bật `NgOptimizedImage`

Hiện tại chưa thấy `NgOptimizedImage` được bật. Khi app có nhiều hình ảnh, cần bật `provideImgixLoader`/`provideCloudinaryLoader` hoặc dùng `NgOptimizedImage` để giảm thời gian tải hình ảnh và tối ưu bandwidth.

---

## 9. Tiêu chí thành công

Hệ thống được coi là ổn nếu:

- màn hình dashboard mở dưới 2–3 giây khi có cache Firebase
- login không trigger quá nhiều request nặng
- khi đổi shop, dữ liệu được filter và load đúng shop cần dùng
- không còn gọi API gốc cho toàn bộ shop mỗi lần render
- khoản dữ liệu lớn được xử lý ở background thay vì block UI
- change detection giảm, render sạch hơn, không còn các vòng lặp không cần thiết
- bundle và route tải theo từng phần, không nặng ngay từ đầu

---

## 10. Kết luận

Vấn đề hiện tại không phải vì Firebase không hoạt động, mà vì:

- app chưa dùng Firebase đúng vai trò, và
- logic tải dữ liệu của nhiều component vẫn đang gọi API gốc quá mạnh,
- bên cạnh đó, source code còn chưa tận dụng các kỹ thuật Angular performance như `OnPush`, `trackBy` toàn diện, lazy loading, preloading, và tránh gọi hàm trong template.

Giải pháp đúng là:

- Firebase làm cache chính,
- app đọc theo shop / resource / TTL,
- giảm số lượng request đồng thời,
- chỉ fetch dữ liệu cần thiết cho màn hình hiện tại,
- đồng thời áp dụng các tối ưu của Angular cho change detection và render.

Vấn đề hiện tại không phải vì Firebase không hoạt động, mà vì:

- app chưa dùng Firebase đúng vai trò, và
- logic tải dữ liệu của nhiều component vẫn đang gọi API gốc quá mạnh.

Giải pháp đúng là:

- Firebase làm cache chính,
- app đọc theo shop / resource / TTL,
- giảm số lượng request đồng thời,
- chỉ fetch dữ liệu cần thiết cho màn hình hiện tại.

Đây là hướng đi tối ưu nhất với điều kiện API bên thứ ba không cho sửa backend.
