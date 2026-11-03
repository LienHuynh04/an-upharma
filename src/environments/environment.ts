export const environment = {
  apiEnabled: true,
  useBackendProxy: false,
  useStaticData: true,
  apiBaseUrl: "https://icpc1hn.work/NHATHUOC",
  directApiBaseUrl: "https://icpc1hn.work/NHATHUOC",
  account: {
    UserName: "",
    Password: "",
  },
  // Không còn excludedShopCodes: SHOP0040/SHOP0162 nay do cấu hình ẩn/hiện
  // ở trang Cài đặt quản lý (xem src/app/shop-visibility.service.ts).
  firebaseDbUrl: "https://an-upharma-default-rtdb.firebaseio.com"
};
