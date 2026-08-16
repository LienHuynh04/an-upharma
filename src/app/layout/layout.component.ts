import { CommonModule } from "@angular/common";
import { Component, OnInit, HostListener } from "@angular/core";
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from "@angular/router";
import { UpharmaService } from "../upharma.service";

@Component({
  selector: "app-layout",
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: "./layout.component.html",
})
export class LayoutComponent implements OnInit {
  appClasses = {
    "is-sidebar-open": false,
    "layout-top": false,
  };
  layoutMode: "left" | "top" = "left";
  menuGroups: Record<string, boolean> = {
    profile: false,
    goods: false,
    stats: false,
    test: false,
    n8n: false,
  };
  userTitle = "Đang tải...";
  brandShopText = "";
  darkMode = false;
  notificationsOpen = false;

  generatingReport = false;
  activeComponent: any = null;

  constructor(public upharma: UpharmaService, public router: Router) {}

  onActivate(componentRef: any) {
    this.activeComponent = componentRef;
  }

  onDeactivate() {
    this.activeComponent = null;
  }

  async generateAndOpenReport() {
    this.generatingReport = true;
    try {
      const session = this.upharma.ensureLogin();
      const shops = this.upharma.getActiveShops();
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();

      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      const formatDateTime = (date: Date) => {
        const pad = (v: number) => String(v).padStart(2, "0");
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
      };

      // 1. Fetch Employee Plans
      const employeePlans: any[] = [];
      await Promise.all(
        shops.map(async (shop) => {
          try {
            const res = await this.upharma.callEndpoint<any>("/EmployeePlan/GetEmployeePlanLst", {
              Month: currentMonth,
              Year: currentYear,
              Token: session.Token,
              uPharmaID: String(session.UserInfo.uPharmaID),
              ShopCode: shop.ShopCode,
            });
            if (res && Array.isArray(res.EmployeePlanLst)) {
              employeePlans.push(...res.EmployeePlanLst);
            }
          } catch (e) {
            console.warn("Failed to load employee plan for", shop.ShopCode, e);
          }
        })
      );

      // 2. Fetch Shop Plans
      const shopPlans: any[] = [];
      const startOfYear = `${currentYear}-01-01 00:00:00`;
      const endOfYear = `${currentYear}-12-31 23:59:59`;
      await Promise.all(
        shops.map(async (shop) => {
          try {
            const res = await this.upharma.callEndpoint<any>("/ShopPlan/GetShopPlanByTime", {
              TimeStart: startOfYear,
              TimeEnd: endOfYear,
              ShopCode: shop.ShopCode,
              Token: session.Token,
              uPharmaID: String(session.UserInfo.uPharmaID),
            });
            if (res && Array.isArray(res.ShopPlanLst)) {
              shopPlans.push(...res.ShopPlanLst);
            }
          } catch (e) {
            console.warn("Failed to load shop plan for", shop.ShopCode, e);
          }
        })
      );

      // 3. Fetch Inventory
      let inventoryRows: any[] = [];
      try {
        const res = await this.upharma.loadInventoryResource({ forceRefresh: false });
        if (res && Array.isArray(res.data)) {
          inventoryRows = res.data;
        }
      } catch (e) {
        console.warn("Failed to load inventory", e);
      }

      // 4. Fetch Orders Report
      const orderReportItems: any[] = [];
      await Promise.all(
        shops.map(async (shop) => {
          try {
            const res = await this.upharma.callEndpoint<any>("/SalesInvoice/GetReportSalesByShop", {
              uPharmaID: session.UserInfo.uPharmaID,
              Token: session.Token,
              TimeStart: formatDateTime(start),
              TimeEnd: formatDateTime(end),
              ShopCode: shop.ShopCode,
            });
            const extractRows = (response: any): any[] => {
              const keys = ["SalesInvoiceLst", "ReportSalesLst", "SalesReportLst", "Data", "data", "DataLst"];
              for (const key of keys) {
                if (Array.isArray(response[key])) return response[key];
              }
              return [];
            };
            const raw = extractRows(res);
            orderReportItems.push(...raw.map((item) => ({ ...item, __shopCode: shop.ShopCode })));
          } catch (e) {
            console.warn("Failed to load order reports for", shop.ShopCode, e);
          }
        })
      );

      const htmlContent = this.buildReportHtml(employeePlans, shopPlans, inventoryRows, orderReportItems);

      const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
      const blobUrl = URL.createObjectURL(blob);

      // Tự động tải xuống file báo cáo
      const downloadLink = document.createElement("a");
      downloadLink.href = blobUrl;
      downloadLink.download = `Bao_Cao_Tong_Hop_Upharma_${currentMonth}_${currentYear}.html`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);

      // Đồng thời mở cửa sổ xem trước
      window.open(blobUrl, "_blank");
    } catch (error) {
      alert("Lỗi khi tạo báo cáo: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      this.generatingReport = false;
    }
  }

  private buildReportHtml(employeePlans: any[], shopPlans: any[], inventoryRows: any[], orderReportItems: any[]): string {
    return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Báo cáo tổng hợp nhà thuốc</title>
<style>
:root {
  --navy:#17365d; --blue:#2563eb; --green:#16a34a; --amber:#d97706;
  --red:#dc2626; --slate:#64748b; --bg:#f3f6fb; --card:#fff;
}
*{box-sizing:border-box}
body{margin:0;font-family:Arial,Helvetica,sans-serif;background:var(--bg);color:#1e293b}
header{background:linear-gradient(135deg,#17365d,#254f7e);color:white;padding:28px 24px}
header .inner,main{max-width:1400px;margin:auto}
h1{margin:0 0 8px;font-size:30px}
.subtitle{margin:0;opacity:.88}
nav{position:sticky;top:0;z-index:20;background:white;border-bottom:1px solid #dbe3ef;padding:10px 18px;display:flex;gap:8px;overflow:auto}
nav a{color:var(--navy);text-decoration:none;font-weight:700;padding:8px 12px;border-radius:7px;background:#eef4fb;white-space:nowrap}
main{padding:22px}
section{background:var(--card);border-radius:14px;box-shadow:0 4px 18px rgba(15,23,42,.08);padding:22px;margin-bottom:22px}
.section-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}
.section-title h2{margin:0;color:var(--navy);font-size:22px}
.section-title p{margin:0;color:var(--slate);font-size:13px}
.chart-shell{position:relative;padding:12px 8px 4px 54px}
.y-axis{position:absolute;left:0;top:12px;bottom:52px;width:48px;display:flex;flex-direction:column;justify-content:space-between;text-align:right;color:#64748b;font-size:11px}
.chart-area{height:390px;border-left:1px solid #94a3b8;border-bottom:1px solid #94a3b8;background:repeating-linear-gradient(to top,transparent 0,transparent calc(25% - 1px),#e5e7eb 25%);display:flex;align-items:stretch;justify-content:space-around;padding:20px 24px 0;gap:28px}
.store-group{flex:1;min-width:240px;display:flex;flex-direction:column}
.bars{height:330px;display:flex;align-items:flex-end;justify-content:center;gap:12px}
.bar-item{height:100%;width:52px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end}
.bar-value{font-size:10px;font-weight:700;margin-bottom:5px;transform:rotate(-55deg);transform-origin:center;white-space:nowrap;height:35px}
.bar-track{height:250px;width:100%;display:flex;align-items:flex-end}
.bar{width:100%;min-height:2px;border-radius:6px 6px 0 0}
.bar-ds{background:#2563eb} .bar-hs{background:#16a34a}
.bar-dsf{background:#f59e0b} .bar-hsf{background:#8b5cf6}
.bar-label{font-size:10px;text-align:center;margin-top:6px;line-height:1.15}
.store-name{text-align:center;font-weight:800;color:var(--navy);font-size:17px;margin-top:8px}
.legend{display:flex;flex-wrap:wrap;gap:16px;justify-content:center;margin-top:16px}
.legend span{display:flex;align-items:center;gap:6px;font-size:13px}
.dot{width:12px;height:12px;border-radius:3px;display:inline-block}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.metric-card{border:1px solid #dbe3ef;border-radius:12px;padding:16px;background:#fbfdff}
.metric-card h3{margin:0 0 12px;color:var(--navy)}
.metric-grid{display:block}
.kpi-row{display:grid;grid-template-columns:140px repeat(3,1fr);gap:10px;margin-bottom:10px}
.kpi-label{display:flex;align-items:center;font-weight:800;color:#17365d;background:#eaf1f8;border:1px solid #cbd5e1;border-radius:8px;padding:10px}
.kpi-cell{border-radius:8px;background:white;padding:10px;border:1px solid #e2e8f0}
.kpi-cell span{display:block;font-size:11px;color:#64748b;margin-bottom:4px}
.kpi-cell strong{font-size:13px;display:block}
.ratio-metric{margin-top:10px;border-radius:8px;background:#eef6ff;border:1px solid #bfdbfe;padding:10px}
.ratio-metric span{display:block;font-size:11px;color:#64748b;margin-bottom:4px}
.ratio-metric strong{font-size:18px;color:#17365d;display:block}
.attainment{display:block;margin-top:5px;color:#475569;font-size:11px;font-weight:700}
table{width:100%;border-collapse:collapse}
th,td{border:1px solid #cbd5e1;padding:10px;text-align:left;vertical-align:top}
th{background:#17365d;color:white;text-align:center}
tbody tr:nth-child(even){background:#f8fafc}
.badge{display:inline-block;padding:4px 8px;border-radius:999px;font-weight:800;font-size:11px}
.pass{background:#dcfce7;color:#166534} .fail{background:#fee2e2;color:#991b1b}
.summary-boxes{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.summary-box{padding:18px;border-radius:12px;border-left:6px solid #2563eb;background:#eff6ff}
.summary-box:nth-child(2){border-left-color:#16a34a;background:#f0fdf4}
.summary-box:nth-child(3){border-left-color:#8b5cf6;background:#f5f3ff}
.summary-box h3{margin:0 0 8px;color:var(--navy)}
.summary-box p{margin:5px 0;line-height:1.45}
.notice{margin-top:14px;padding:12px 14px;border-radius:8px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412}
.week-plan{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.plan-card{border:1px solid #dbe3ef;border-radius:12px;padding:18px;background:#fbfdff}
.plan-card h3{margin:0 0 10px;color:var(--navy)}
.plan-card ul{margin:0;padding-left:20px}
.plan-card li{margin:8px 0;line-height:1.45}
.plan-card strong{color:#0f172a}
footer{text-align:center;color:#64748b;padding:12px 20px 30px;font-size:12px}
@media(max-width:900px){
  .kpi-row{grid-template-columns:1fr}
  .kpi-label{justify-content:center}
  .cards,.summary-boxes,.week-plan{grid-template-columns:1fr}
  .chart-area{overflow-x:auto;justify-content:flex-start}
  .store-group{flex:0 0 270px}
}
@media print{
  nav{display:none} body{background:white} main{padding:0}
  section{box-shadow:none;border:1px solid #d1d5db;page-break-inside:avoid}
}
</style>
</head>
<body>
<header><div class="inner">
  <h1 id="header-title">BÁO CÁO TỔNG HỢP NHÀ THUỐC</h1>
  <p class="subtitle" id="header-subtitle">Chỉ tiêu • Tồn kho • Nhân sự • Lộ trình thực tế</p>
</div></header>

<nav>
  <a href="#chi-tieu">Chỉ tiêu nhà thuốc</a>
  <a href="#ton-kho">Tồn kho cận hạn</a>
  <a href="#nhan-su">Chỉ tiêu nhân viên</a>
  <a href="#don-hang">Đơn hàng bán ra</a>
</nav>

<main>
<section id="chi-tieu">
  <div class="section-title">
    <h2>📊 Chỉ tiêu nhà thuốc</h2>
    <p>Biểu đồ thể hiện DS và HS thực tế so với chỉ tiêu</p>
  </div>
  <div class="chart-shell">
    <div class="y-axis"><span>150%</span><span>112.5%</span><span>75%</span><span>37.5%</span><span>0%</span></div>
    <div class="chart-area" id="chart-area-container">
      <!-- Dynamic Chart Groups inserted here -->
    </div>
  </div>
  <div class="legend">
    <span><i class="dot bar-ds"></i>DS thực tế</span>
    <span><i class="dot bar-hs"></i>HS thực tế</span>
  </div>
  <div class="cards" style="margin-top:20px" id="shop-cards-container">
    <!-- Dynamic Cards inserted here -->
  </div>
</section>

<section id="ton-kho">
  <div class="section-title">
    <h2>📦 Đánh giá tồn kho cận hạn</h2>
    <p>Ngưỡng: dưới 6 tháng &lt; 1,20% • dưới 12 tháng &lt; 8,00%</p>
  </div>
  <div style="overflow:auto">
  <table>
    <thead><tr>
      <th>Nhà thuốc</th><th>Cận hạn dưới 6 tháng</th><th>Đánh giá dưới 6 tháng</th>
      <th>Cận hạn dưới 12 tháng</th><th>Đánh giá dưới 12 tháng</th><th>Kết quả chung</th>
    </tr></thead>
    <tbody id="inventory-table-body">
      <!-- Dynamic inventory evaluation rows -->
    </tbody>
  </table>
  </div>
</section>

<section id="nhan-su">
  <div class="section-title">
    <h2>👥 Chỉ tiêu nhân viên</h2>
    <p>Tình hình thực hiện chỉ tiêu theo từng nhân sự</p>
  </div>
  <div style="overflow:auto">
  <table>
    <thead><tr>
      <th>Nhân viên</th><th>Mã NV</th><th>Nhà thuốc</th>
      <th>Doanh thu thực tế / Chỉ tiêu</th>
      <th>Hóa đơn thực tế / Chỉ tiêu</th>
      <th>Khách mới thực tế / Chỉ tiêu</th>
      <th>Trạng thái</th>
    </tr></thead>
    <tbody id="employee-table-body">
      <!-- Dynamic employee rows -->
    </tbody>
  </table>
  </div>
</section>

<section id="don-hang">
  <div class="section-title">
    <h2>📋 Đơn hàng bán ra (Thuốc cận hạn)</h2>
    <p>Danh sách giao dịch xuất bán hàng cận hạn trong tháng</p>
  </div>
  <div style="overflow:auto">
  <table>
    <thead><tr>
      <th>Ngày bán</th><th>Nhà thuốc</th><th>Nhân viên</th>
      <th>Mã SP</th><th>Tên sản phẩm</th><th>Hạn dùng</th><th>Doanh thu</th>
    </tr></thead>
    <tbody id="orders-table-body">
      <!-- Dynamic order rows -->
    </tbody>
  </table>
  </div>
</section>
</main>

<footer>
Hệ thống báo cáo tự động UPHARMA. Xuất bản lúc ${new Date().toLocaleString()}.
</footer>

<script>
const mockEmployees = ${JSON.stringify(employeePlans)};
const mockShops = ${JSON.stringify(shopPlans)};
const mockInventory = ${JSON.stringify(inventoryRows)};
const mockOrders = ${JSON.stringify(orderReportItems)};

function formatMoney(val) {
  return new Intl.NumberFormat('vi-VN').format(val || 0) + " đ";
}

// Generate Shop KPI Cards & Dynamic Charts
const chartContainer = document.getElementById('chart-area-container');
const shopCardsContainer = document.getElementById('shop-cards-container');

if (mockShops.length === 0) {
  chartContainer.innerHTML = '<div style="margin: auto; color: var(--slate)">Không có dữ liệu chỉ tiêu</div>';
  shopCardsContainer.innerHTML = '<div>Không có dữ liệu chi tiết</div>';
} else {
  mockShops.forEach(shop => {
    const dsAttainment = Math.round(((shop.AmountR || 0) / (shop.Amount || 1)) * 100);
    const hsAttainment = Math.round(((shop.PointSales01R || 0) / (shop.PointSales01 || 1)) * 100);

    const dsBarHeight = Math.min(100, Math.round((dsAttainment / 150) * 100));
    const hsBarHeight = Math.min(100, Math.round((hsAttainment / 150) * 100));

    // Dynamic Chart Group
    const group = document.createElement('div');
    group.className = 'store-group';
    group.innerHTML = \`
      <div class="bars">
        <div class="bar-item">
          <div class="bar-value">\${dsAttainment}%</div>
          <div class="bar-track"><div class="bar bar-ds" style="height:\${dsBarHeight}%"></div></div>
          <div class="bar-label">DS thực tế</div>
        </div>
        <div class="bar-item">
          <div class="bar-value">\${hsAttainment}%</div>
          <div class="bar-track"><div class="bar bar-hs" style="height:\${hsBarHeight}%"></div></div>
          <div class="bar-label">HS thực tế</div>
        </div>
      </div>
      <div class="store-name">\${shop.ShopCode}</div>
    \`;
    chartContainer.appendChild(group);

    // KPI Cards
    const card = document.createElement('article');
    card.className = 'metric-card';
    card.innerHTML = \`
      <h3>Nhà \${shop.ShopCode}</h3>
      <div class="metric-grid">
        <div class="kpi-row">
          <div class="kpi-label">Doanh số</div>
          <div class="kpi-cell"><span>Chỉ tiêu</span><strong>\${formatMoney(shop.Amount)}</strong></div>
          <div class="kpi-cell"><span>Thực tế</span><strong>\${formatMoney(shop.AmountR)}</strong><small class="attainment">Đạt \${dsAttainment}%</small></div>
        </div>
        <div class="kpi-row">
          <div class="kpi-label">Hệ số</div>
          <div class="kpi-cell"><span>Chỉ tiêu</span><strong>\${shop.PointSales01 || 0}</strong></div>
          <div class="kpi-cell"><span>Thực tế</span><strong>\${shop.PointSales01R || 0}</strong><small class="attainment">Đạt \${hsAttainment}%</small></div>
        </div>
      </div>
    \`;
    shopCardsContainer.appendChild(card);
  });
}

// Generate Expiry Inventory Assessment
const invTbody = document.getElementById('inventory-table-body');
const shopInventoryStats = {};

mockInventory.forEach(item => {
  const shop = item.ShopCode || item.__shopCode || 'N/A';
  if (!shopInventoryStats[shop]) {
    shopInventoryStats[shop] = { total: 0, under6m: 0, under12m: 0 };
  }
  shopInventoryStats[shop].total += 1;

  // Expiry calculation
  if (item.ExpirationDate || item.ExpDateTxt || item.HSD || item.HanDung) {
    const today = new Date();
    const expDate = new Date(String(item.ExpirationDate || item.ExpDateTxt || item.HSD || item.HanDung).trim().replace(' ', 'T'));
    if (!isNaN(expDate.getTime())) {
      const diffMs = expDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays <= 180) shopInventoryStats[shop].under6m += 1;
      if (diffDays <= 365) shopInventoryStats[shop].under12m += 1;
    }
  }
});

const activeShopsList = Object.keys(shopInventoryStats);
if (activeShopsList.length === 0) {
  invTbody.innerHTML = '<tr><td colspan="6" style="text-align:center">Không có dữ liệu tồn kho</td></tr>';
} else {
  activeShopsList.forEach(shop => {
    const stats = shopInventoryStats[shop];
    const rate6 = stats.total > 0 ? ((stats.under6m / stats.total) * 100).toFixed(2) : '0.00';
    const rate12 = stats.total > 0 ? ((stats.under12m / stats.total) * 100).toFixed(2) : '0.00';

    const p6 = parseFloat(rate6) < 1.20;
    const p12 = parseFloat(rate12) < 8.00;
    const passAll = p6 && p12;

    const row = document.createElement('tr');
    row.innerHTML = \`
      <td><strong>\${shop}</strong></td>
      <td>\${rate6}%</td>
      <td><span class="badge \${p6 ? 'pass' : 'fail'}">\${p6 ? 'ĐẠT' : 'KHÔNG ĐẠT'}</span></td>
      <td>\${rate12}%</td>
      <td><span class="badge \${p12 ? 'pass' : 'fail'}">\${p12 ? 'ĐẠT' : 'KHÔNG ĐẠT'}</span></td>
      <td><span class="badge \${passAll ? 'pass' : 'fail'}">\${passAll ? 'ĐẠT' : 'KHÔNG ĐẠT'}</span></td>
    \`;
    invTbody.appendChild(row);
  });
}

// Generate Employee Plan Data
const empTbody = document.getElementById('employee-table-body');
if (mockEmployees.length === 0) {
  empTbody.innerHTML = '<tr><td colspan="7" style="text-align:center">Không có dữ liệu chỉ tiêu nhân viên</td></tr>';
} else {
  mockEmployees.forEach(emp => {
    const isMet = (emp.AmountR || 0) >= (emp.Amount || 0);
    const row = document.createElement('tr');
    row.innerHTML = \`
      <td><strong>\${emp.EmployeeName || emp.SalesName || 'N/A'}</strong></td>
      <td><code>\${emp.EmployeeCode || 'N/A'}</code></td>
      <td>\${emp.ShopCode || 'N/A'}</td>
      <td>\${formatMoney(emp.AmountR)} / <span style="color: var(--slate)">\${formatMoney(emp.Amount)}</span></td>
      <td>\${emp.QuantityInvoiceR || 0} / \${emp.QuantityInvoice || 0}</td>
      <td>\${emp.QuantityCusNewR || 0} / \${emp.QuantityCusNew || 0}</td>
      <td><span class="badge \${isMet ? 'pass' : 'fail'}">\${isMet ? 'ĐẠT' : 'CHƯA ĐẠT'}</span></td>
    \`;
    empTbody.appendChild(row);
  });
}

// Generate Orders Report
const orderTbody = document.getElementById('orders-table-body');
if (mockOrders.length === 0) {
  orderTbody.innerHTML = '<tr><td colspan="7" style="text-align:center">Không có dữ liệu đơn hàng cận đát</td></tr>';
} else {
  mockOrders.forEach(o => {
    const row = document.createElement('tr');
    row.innerHTML = \`
      <td>\${o.OrderDate || o.InvoiceDate || 'N/A'}</td>
      <td>\${o.__shopCode || 'N/A'}</td>
      <td><strong>\${o.SalesName || o.EmployeeName || 'N/A'}</strong></td>
      <td><code>\${o.ProductID || o.ProductCode || 'N/A'}</code></td>
      <td>\${o.ProductName || 'N/A'}</td>
      <td>\${o.ExpirationDate || 'N/A'}</td>
      <td><strong>\${formatMoney(o.Amount || o.ThanhTien)}</strong></td>
    \`;
    orderTbody.appendChild(row);
  });
}
</script>
</body>
</html>`;
  }

  showLogoutConfirm = false;

  ngOnInit() {
    const savedDarkMode = localStorage.getItem("upharma_dark_mode");
    this.darkMode = savedDarkMode === null ? true : savedDarkMode === "true";
    if (savedDarkMode === null) {
      localStorage.setItem("upharma_dark_mode", "true");
    }
    this.applyDarkMode();
    this.checkSession();
    this.syncMenuState(this.router.url);
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.syncMenuState(event.urlAfterRedirects || event.url);
      }
    });
  }

  get userInitial(): string {
    return (this.userTitle.trim().split(/\s+/).at(-1) || "U").slice(0, 1).toUpperCase();
  }

  checkSession() {
    if (!this.upharma.isAuthenticated()) {
      this.router.navigate(["/login"]);
      return;
    }
    const session = this.upharma.getSession();
    if (session && session.UserInfo) {
      this.userTitle = session.UserInfo.FullName || "Admin";
      this.brandShopText = session.UserInfo.ShopLst?.[0]?.ShopCode || "";
    }
  }

  toggleSidebar() {
    this.appClasses["is-sidebar-open"] = !this.appClasses["is-sidebar-open"];
  }

  closeSidebar(): void {
    this.appClasses["is-sidebar-open"] = false;
  }

  get sidebarToggleLabel(): string {
    return this.appClasses["is-sidebar-open"] ? "Đóng menu" : "Mở menu";
  }

  get sidebarToggleIcon(): string {
    return this.appClasses["is-sidebar-open"] ? "×" : "☰";
  }

  toggleDarkMode() {
    this.darkMode = !this.darkMode;
    localStorage.setItem("upharma_dark_mode", String(this.darkMode));
    this.applyDarkMode();
  }

  private applyDarkMode() {
    if (this.darkMode) {
      document.documentElement.setAttribute("data-bs-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-bs-theme");
    }
  }

  toggleNotifications() {
    this.notificationsOpen = !this.notificationsOpen;
  }

  setLayoutMode(mode: "left" | "top") {
    this.layoutMode = mode;
    this.appClasses["layout-top"] = mode === "top";
  }

  openMenuId: string | null = null;

  toggleMenuGroup(group: string, event?: Event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    this.openMenuId = this.openMenuId === group ? null : group;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event) {
    this.openMenuId = null;
  }

  @HostListener('document:keydown.escape')
  onEscapeKey() {
    this.openMenuId = null;
    if (this.showLogoutConfirm) {
      this.cancelLogout();
    }
  }

  private syncMenuState(url: string): void {
    const isStatsRoute =
      url.includes("/chi-tieu-nhan-vien") || url.includes("/chi-tieu-nha-thuoc-trong-nam");
    const isGoodsRoute =
      url.includes("/ton-kho") ||
      url.includes("/ton-kho-new") ||
      url.includes("/hang-da-het") ||
      url.includes("/hang-lap-tot") ||
      url.includes("/hang-ban-cham") ||
      url.includes("/in-tem") ||
      url.includes("/lay-bao-cao-don-hang");
    this.menuGroups["stats"] = isStatsRoute;
    this.menuGroups["goods"] = isGoodsRoute;
  }

  openLogoutConfirm(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    this.showLogoutConfirm = true;
  }

  async confirmLogout() {
    this.showLogoutConfirm = false;
    this.upharma.clearSession();
    await this.router.navigateByUrl("/login", { replaceUrl: true });
  }

  cancelLogout() {
    this.showLogoutConfirm = false;
  }
}
