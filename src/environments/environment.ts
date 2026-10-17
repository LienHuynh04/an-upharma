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
  excludedShopCodes: ["SHOP0040"],
  firebaseDbUrl: "https://an-upharma-default-rtdb.firebaseio.com",
  // Gemini API key nhúng sẵn (tự động, không cần nhập tay).
  // Cách lấy: aistudio.google.com/apikey → Create API key → dán vào đây.
  // BẢO MẬT: vào Google Cloud Console → APIs & Services → Credentials → key này
  // → Application restrictions → HTTP referrers → thêm domain GitHub Pages của bạn
  // (vd: lienhuynh04.github.io/*). Key bị lộ cũng không dùng được ở domain khác.
  geminiApiKey: ""
};
