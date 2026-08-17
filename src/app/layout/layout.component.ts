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
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Báo cáo tổng hợp UPHARMA tháng ${currentMonth}/${currentYear}</title>
<style>
:root{
  --navy:#17365d;--navy-2:#254f7e;--blue:#2563eb;--green:#16a34a;
  --amber:#d97706;--red:#dc2626;--purple:#8b5cf6;--slate:#64748b;
  --bg:#f3f6fb;--card:#fff;--line:#dbe3ef;--soft:#f8fafc;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:Arial,Helvetica,sans-serif;background:var(--bg);color:#1e293b}
header{background:linear-gradient(135deg,var(--navy),var(--navy-2));color:#fff;padding:25px 24px}
header .inner,main{max-width:1400px;margin:auto}
.header-row{display:flex;align-items:center;justify-content:space-between;gap:28px}
h1{margin:0 0 8px;font-size:30px}.subtitle{margin:0;opacity:.88}
.filters{display:flex;align-items:flex-end;gap:10px}
.field{display:grid;gap:5px}.field label{font-size:12px;font-weight:700;opacity:.9}
.field select{min-width:115px;padding:9px 34px 9px 11px;border:1px solid rgba(255,255,255,.35);border-radius:8px;background:#fff;color:var(--navy);font-weight:800}
.view-btn{padding:10px 17px;border:0;border-radius:8px;color:#fff;background:#d99a16;font-weight:800;box-shadow:0 2px 6px rgba(0,0,0,.18);cursor:pointer}
nav{position:sticky;top:0;z-index:20;background:#fff;border-bottom:1px solid var(--line);padding:10px 18px;display:flex;gap:8px;overflow:auto}
nav a{color:var(--navy);text-decoration:none;font-weight:700;padding:8px 12px;border-radius:7px;background:#eef4fb;white-space:nowrap}
main{padding:22px}
section{background:var(--card);border-radius:14px;box-shadow:0 4px 18px rgba(15,23,42,.08);padding:22px;margin-bottom:22px}
.section-title{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}
.section-title h2{margin:0;color:var(--navy);font-size:22px}.section-title p{margin:0;color:var(--slate);font-size:13px;text-align:right}
.dashboard-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}
.summary-kpi{padding:15px;border:1px solid var(--line);border-radius:11px;background:linear-gradient(180deg,#fff,#f8fbff)}
.summary-kpi span{display:block;color:var(--slate);font-size:12px;margin-bottom:6px}.summary-kpi strong{color:var(--navy);font-size:21px}
.chart-shell{position:relative;padding:12px 8px 4px 54px}
.y-axis{position:absolute;left:0;top:12px;bottom:52px;width:48px;display:flex;flex-direction:column;justify-content:space-between;text-align:right;color:var(--slate);font-size:11px}
.chart-area{height:380px;border-left:1px solid #94a3b8;border-bottom:1px solid #94a3b8;background:repeating-linear-gradient(to top,transparent 0,transparent calc(25% - 1px),#e5e7eb 25%);display:flex;align-items:stretch;justify-content:space-around;padding:20px 24px 0;gap:28px}
.store-group{flex:1;min-width:240px;display:flex;flex-direction:column}.bars{height:320px;display:flex;align-items:flex-end;justify-content:center;gap:16px}
.bar-item{height:100%;width:62px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end}
.bar-value{font-size:11px;font-weight:800;margin-bottom:5px;white-space:nowrap;height:18px}.bar-track{height:250px;width:100%;display:flex;align-items:flex-end}
.bar{width:100%;min-height:2px;border-radius:7px 7px 0 0;box-shadow:inset 0 1px rgba(255,255,255,.28)}
.bar-ds{background:var(--blue)}.bar-hhs{background:var(--green)}.bar-label{font-size:10px;text-align:center;margin-top:6px;line-height:1.15}
.store-name{text-align:center;font-weight:800;color:var(--navy);font-size:17px;margin-top:8px}
.legend{display:flex;flex-wrap:wrap;gap:16px;justify-content:center;margin-top:15px}.legend span{display:flex;align-items:center;gap:6px;font-size:13px}.dot{width:12px;height:12px;border-radius:3px;display:inline-block}
.shop-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:20px}
.shop-card{border:1px solid var(--line);border-radius:12px;padding:16px;background:#fbfdff}
.shop-card-head{display:flex;justify-content:space-between;align-items:start;gap:10px;margin-bottom:13px}.shop-card h3{margin:0;color:var(--navy)}
.updated{color:var(--slate);font-size:11px;text-align:right}.kpi-row{display:grid;grid-template-columns:92px repeat(3,1fr);gap:8px;margin-bottom:9px}
.kpi-label{display:flex;align-items:center;font-weight:800;color:var(--navy);background:#eaf1f8;border:1px solid #cbd5e1;border-radius:8px;padding:9px}
.kpi-cell{border-radius:8px;background:#fff;padding:9px;border:1px solid #e2e8f0;min-width:0}.kpi-cell span{display:block;font-size:10px;color:var(--slate);margin-bottom:4px}.kpi-cell strong{font-size:12px;display:block;overflow-wrap:anywhere}
.attainment{display:block;margin-top:5px;color:#475569;font-size:10px;font-weight:700}.ratio-metric{margin-top:9px;border-radius:8px;background:#eef6ff;border:1px solid #bfdbfe;padding:10px}.ratio-metric span{display:block;font-size:10px;color:var(--slate);margin-bottom:4px}.ratio-metric strong{font-size:18px;color:var(--navy);display:block}
.shop-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}
.shop-tab{padding:13px 15px;text-align:left;border:1px solid var(--line);border-radius:10px;background:#f8fafc;color:var(--navy);cursor:pointer}
.shop-tab.active{color:#fff;border-color:var(--navy);background:linear-gradient(135deg,var(--navy),var(--navy-2))}.shop-tab strong,.shop-tab span,.shop-tab small{display:block}.shop-tab span{margin-top:5px;font-size:12px}.shop-tab small{margin-top:5px;opacity:.75}
.inventory-hero{padding:18px 20px;border-radius:12px;color:#fff;background:linear-gradient(135deg,var(--navy),var(--navy-2));margin-bottom:14px}
.inventory-hero h3{margin:0 0 8px;font-size:19px}.inventory-legend{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:18px}.inventory-legend span{display:flex;align-items:center;gap:6px;font-size:12px;opacity:.92}.legend-square{width:11px;height:11px;border-radius:3px}.sq-expired{background:#b9c0c4}.sq-3m{background:#ff3b43}.sq-6m{background:#5573f4}.sq-1y{background:#20a65a}
.inventory-total{font-size:18px}.inventory-total strong{font-size:25px}
.inventory-cards{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:14px}
.inventory-card{position:relative;min-width:0;padding:13px 13px 13px 17px;border:1px solid var(--line);border-radius:11px;background:#fff;overflow:hidden}
.inventory-card:before{content:"";position:absolute;left:0;top:0;bottom:0;width:6px;background:#e0a21c}.inventory-card.expired:before{background:#aeb7bc}.inventory-card.three:before{background:#ff3b43}.inventory-card.six:before{background:#5573f4}.inventory-card.year:before{background:#20a65a}.inventory-card.normal:before{background:#f2c400}
.inventory-card span{display:block;color:var(--slate);font-size:11px;font-weight:700}.inventory-card strong{display:block;margin-top:7px;color:var(--navy);text-align:right;font-size:20px}.inventory-card small{display:block;margin-top:4px;text-align:right;color:#475569;font-weight:700}.inventory-card em{display:block;margin-top:5px;text-align:right;color:var(--navy);font-style:normal;font-weight:800}
.inventory-shops{padding:14px;border:1px solid var(--line);border-radius:12px;background:#f8fafc}.inventory-shops h3{margin:0 0 11px;color:var(--navy);font-size:16px}.inventory-shop-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.inventory-shop{padding:12px;text-align:left;border:1px solid var(--line);border-radius:9px;background:#fff;color:var(--navy);cursor:pointer}.inventory-shop.active{border:2px solid #d99a16;background:#fff8e7}.inventory-shop strong{display:block}.inventory-shop span{display:block;margin-top:5px;color:var(--slate);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.inventory-shop b{float:right;color:#c9860e;font-size:18px}
.expiry-order-controls{display:grid;grid-template-columns:1.3fr 2.5fr auto;gap:14px;align-items:end;padding:16px;border:1px solid var(--line);border-radius:12px;background:#f8fafc;margin-bottom:14px}
.expiry-order-field{display:grid;gap:6px}.expiry-order-field label{color:var(--slate);font-size:12px;font-weight:800}.expiry-order-field select{width:100%;padding:11px 35px 11px 12px;border:1px solid #cbd5e1;border-radius:9px;background:#fff;color:var(--navy);font-weight:800}
.range-buttons{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.range-btn{padding:11px 13px;text-align:left;border:1px solid #cbd5e1;border-radius:9px;background:#fff;color:var(--navy);font-weight:800;cursor:pointer}.range-btn.active{border:2px solid #d99a16;background:#fff8e7;box-shadow:inset 6px 0 #e1a21c}
.reset-btn{padding:12px 18px;border:0;border-radius:9px;color:#fff;background:linear-gradient(180deg,#efb438,#d99a16);font-weight:800;cursor:pointer}
.employee-order-panel{padding:18px;border:1px solid var(--line);border-radius:12px;background:#fff}.employee-order-head{display:flex;align-items:end;justify-content:space-between;gap:15px;margin-bottom:15px}.employee-order-head h3{margin:0 0 5px;color:var(--navy);font-size:19px}.employee-order-head p{margin:0;color:var(--slate);font-size:12px}.employee-count{color:#c9860e;font-weight:800;white-space:nowrap}
.order-employee-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.order-employee-card{min-height:90px;padding:14px;display:flex;align-items:center;justify-content:space-between;gap:14px;border:1px solid var(--line);border-radius:10px;background:#f8fafc;color:#1e293b;cursor:pointer;text-align:left}.order-employee-card.active{border:2px solid #d99a16;background:#fff8e7;box-shadow:inset 6px 0 #e1a21c}.order-employee-card span{font-weight:800}.order-employee-card strong{color:#c9860e;font-size:18px;white-space:nowrap}.order-empty{grid-column:1/-1;padding:35px;text-align:center;color:var(--slate);border:1px dashed #cbd5e1;border-radius:10px}
.operation-title{display:flex;align-items:center;gap:9px;margin:0 0 13px;color:var(--navy);font-size:18px}.operation-title:before{content:"";width:5px;height:24px;border-radius:999px;background:var(--blue)}
.promotion-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}.promotion-card{position:relative;padding:16px;border:1px solid var(--line);border-radius:11px;background:#fbfdff;overflow:hidden}.promotion-card:before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;background:var(--blue)}.promotion-card:nth-child(2):before{background:var(--amber)}.promotion-card:nth-child(3):before{background:var(--purple)}
.promotion-card-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px}.promotion-card h4{margin:0;color:var(--navy);font-size:17px}.operation-status{padding:4px 7px;border-radius:999px;background:#dcfce7;color:#166534;font-size:10px;font-weight:800;white-space:nowrap}.operation-status.internal{background:#fff7ed;color:#9a3412}.operation-status.pending{background:#f3e8ff;color:#6b21a8}.promotion-card p{margin:0;color:#475569;font-size:13px;line-height:1.55}
.operation-info-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.operation-info{padding:16px;border:1px solid var(--line);border-radius:11px;background:#fff}.operation-info h4{margin:0 0 9px;color:var(--navy);font-size:16px}.operation-info p{margin:0;color:#475569;font-size:13px;line-height:1.6}.operation-info strong{color:var(--navy)}
.next-week-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.next-week-card{position:relative;padding:17px;border:1px solid var(--line);border-radius:11px;background:linear-gradient(180deg,#fff,#f8fbff);overflow:hidden}.next-week-card:before{content:"";position:absolute;left:0;top:0;bottom:0;width:6px;background:var(--blue)}.next-week-card:nth-child(2):before{background:var(--green)}.next-week-card:nth-child(3):before{background:var(--purple)}.next-week-card h3{margin:0 0 11px;color:var(--navy);font-size:18px}.next-week-card ul{margin:0;padding-left:20px;color:#475569}.next-week-card li{margin:8px 0;line-height:1.5;font-size:13px}.next-week-card strong{color:var(--navy)}
.table-wrap{overflow:auto;border:1px solid #cbd5e1;border-radius:10px}
table{width:100%;min-width:1280px;border-collapse:collapse}th,td{border-right:1px solid #cbd5e1;border-bottom:1px solid #cbd5e1;padding:10px;text-align:left;vertical-align:middle}th:last-child,td:last-child{border-right:0}tbody tr:last-child td{border-bottom:0}
th{background:var(--navy);color:#fff;text-align:center;font-size:12px;white-space:nowrap}tbody tr:nth-child(even){background:var(--soft)}tbody tr:hover{background:#eff6ff}
.identity strong{display:block;color:var(--navy)}.identity span{display:block;margin-top:4px;color:var(--slate);font-size:12px}.cell-number{white-space:nowrap}.cell-number strong{display:block;color:var(--green)}.cell-number span{display:block;margin-top:4px;color:var(--slate);font-size:11px}
.progress{height:6px;margin-top:6px;background:#e2e8f0;border-radius:999px;overflow:hidden}.progress i{display:block;height:100%;background:linear-gradient(90deg,var(--blue),#60a5fa);border-radius:inherit}
.ratio-badge{display:inline-block;padding:5px 8px;border-radius:999px;background:#fff7ed;color:#9a3412;font-weight:800;font-size:12px}.summary-line{padding:12px 14px;background:#eef6ff;color:var(--navy);font-size:13px}.green{color:var(--green)!important}.amber{color:var(--amber)!important}
footer{text-align:center;color:var(--slate);padding:12px 20px 30px;font-size:12px}
@media(max-width:1050px){.header-row{align-items:flex-start;flex-direction:column}.dashboard-summary{grid-template-columns:repeat(2,1fr)}.shop-cards{grid-template-columns:1fr}.shop-tabs{overflow-x:auto;grid-template-columns:repeat(3,minmax(280px,1fr))}.chart-area{overflow-x:auto;justify-content:flex-start}.store-group{flex:0 0 270px}.inventory-cards{grid-template-columns:repeat(3,1fr)}.expiry-order-controls{grid-template-columns:1fr}.order-employee-grid{grid-template-columns:repeat(2,1fr)}.promotion-grid,.next-week-grid{grid-template-columns:1fr}}
@media(max-width:620px){header{padding:22px 16px}h1{font-size:24px}.filters{width:100%;display:grid;grid-template-columns:1fr 1fr}.field select{width:100%}.view-btn{grid-column:1/-1}.section-title{align-items:flex-start;flex-direction:column}.section-title p{text-align:left}.dashboard-summary{grid-template-columns:1fr}.kpi-row{grid-template-columns:1fr}.inventory-cards{grid-template-columns:repeat(2,1fr)}.inventory-shop-grid{grid-template-columns:1fr}.range-buttons{grid-template-columns:1fr}.employee-order-head{align-items:flex-start;flex-direction:column}.order-employee-grid{grid-template-columns:1fr}.operation-info-grid{grid-template-columns:1fr}main{padding:12px}section{padding:16px}}
@media print{nav,.filters{display:none}body{background:#fff}main{padding:0}section{box-shadow:none;border:1px solid #d1d5db;page-break-inside:avoid}}
</style>
</head>
<body>
<header><div class="inner header-row">
  <div style="display: flex; align-items: center; gap: 15px;">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" style="width: 48px; height: 48px;">
      <defs>
        <linearGradient id="p" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#ffb834" />
          <stop offset="100%" stop-color="#f05a28" />
        </linearGradient>
        <linearGradient id="l" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#009245" />
          <stop offset="100%" stop-color="#8cc63f" />
        </linearGradient>
      </defs>
      <path d="M 12 8 A 4 4 0 0 1 20 8 L 20 12 L 12 12 Z" fill="url(#p)" />
      <path d="M 9 10 C 7 10, 7 18, 7 20 C 7 24.5, 11 27, 16 27 C 21 27, 25 24.5, 25 20 C 25 18, 25 10, 23 10 C 22.5 10, 22 13, 22 16 C 22 21.5, 19 23, 16 23 C 13 23, 10 21.5, 10 16 C 10 13, 9.5 10, 9 10 Z" fill="url(#l)" />
    </svg>
    <div>
      <h1 style="margin: 0; font-size: 26px;">BÁO CÁO TỔNG HỢP UPHARMA</h1>
      <p class="subtitle" style="margin: 4px 0 0; opacity: 0.88;">Chỉ tiêu nhà thuốc • Chỉ tiêu nhân viên • Tháng ${currentMonth}/${currentYear}</p>
    </div>
  </div>
  <div class="filters">
    <div class="field">
      <label for="month-select">Tháng</label>
      <select id="month-select">
        ${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i + 1 === currentMonth ? "selected" : ""}>${i + 1}</option>`).join("")}
      </select>
    </div>
    <div class="field">
      <label for="year-select">Năm</label>
      <select id="year-select">
        ${Array.from({ length: 5 }, (_, i) => `<option value="${currentYear - 2 + i}" ${currentYear - 2 + i === currentYear ? "selected" : ""}>${currentYear - 2 + i}</option>`).join("")}
      </select>
    </div>
    <button class="view-btn" id="view-btn" type="button">Xem báo cáo</button>
  </div>
</div></header>
<nav><a href="#chi-tieu">Chỉ tiêu nhà thuốc</a><a href="#ton-kho">Tỷ lệ cận date</a><a href="#don-hang-can-date">Đơn hàng cận date</a><a href="#nhan-vien">Chỉ tiêu nhân viên</a><a href="#van-hanh">Vận hành</a><a href="#ke-hoach-tuan-toi">KH tuần tới</a></nav>
<main>
  <section id="chi-tieu">
    <div class="section-title"><h2>📊 Dashboard chỉ tiêu nhà thuốc</h2><p>Doanh số và HHS thực tế so với chỉ tiêu<br><small>Dữ liệu lũy kế thực tế và dự kiến cả tháng</small></p></div>
    <div class="dashboard-summary" id="dashboard-summary"></div>
    <div class="chart-shell"><div class="y-axis"><span>150%</span><span>112,5%</span><span>75%</span><span>37,5%</span><span>0%</span></div><div class="chart-area" id="chart-area"></div></div>
    <div class="legend"><span><i class="dot bar-ds"></i>DS thực tế</span><span><i class="dot bar-hhs"></i>HHS thực tế</span></div>
    <div class="shop-cards" id="shop-cards"></div>
  </section>
  <section id="ton-kho">
    <div class="section-title"><h2>📦 Tỷ lệ cận date</h2><p>Giá trị và tỷ lệ hàng hóa theo thời hạn sử dụng</p></div>
    <div class="inventory-hero">
      <h3>Danh mục tồn kho</h3>
      <div class="inventory-legend"><span><i class="legend-square sq-expired"></i>Hết hạn</span><span><i class="legend-square sq-3m"></i>3 Tháng</span><span><i class="legend-square sq-6m"></i>6 Tháng</span><span><i class="legend-square sq-1y"></i>1 Năm</span></div>
      <div class="inventory-total">Tổng giá trị đang hiển thị: <strong id="inventory-total-value">0 VNĐ</strong></div>
    </div>
    <div class="inventory-cards" id="inventory-cards"></div>
    <div class="inventory-shops"><h3>Nhà thuốc</h3><div class="inventory-shop-grid" id="inventory-shop-grid"></div></div>
  </section>
  <section id="don-hang-can-date">
    <div class="section-title"><h2>🧾 Đơn hàng cận date</h2><p>Tổng tiền hàng cận date theo nhà thuốc, khoảng lọc và nhân viên</p></div>
    <div class="expiry-order-controls">
      <div class="expiry-order-field"><label for="expiry-order-shop">Nhà thuốc</label><select id="expiry-order-shop"></select></div>
      <div class="expiry-order-field"><label>Khoảng lọc</label><div class="range-buttons" id="expiry-range-buttons"></div></div>
      <button class="reset-btn" id="expiry-reset-btn" type="button">Làm mới</button>
    </div>
    <div class="employee-order-panel">
      <div class="employee-order-head"><div><h3>Tổng quan theo nhân viên</h3><p>Chọn một nhân viên để làm nổi bật nhanh tổng tiền.</p></div><div class="employee-count" id="expiry-employee-count"></div></div>
      <div class="order-employee-grid" id="expiry-employee-grid"></div>
    </div>
  </section>
  <section id="nhan-vien">
    <div class="section-title"><h2>👥 Bảng chỉ tiêu nhân viên</h2><p id="employee-caption">Thực tế, chỉ tiêu và dự kiến theo từng nhân sự</p></div>
    <div class="shop-tabs" id="shop-tabs"></div>
    <div class="table-wrap" id="employee-table"></div>
  </section>
  <section id="van-hanh">
    <div class="section-title"><h2>⚙️ Vận hành</h2><p>Chương trình khuyến mãi, hàng hoá và chăm sóc khách hàng</p></div>
    <h3 class="operation-title">Chương trình khuyến mãi (CTKM)</h3>
    <div class="promotion-grid">
      <article class="promotion-card">
        <div class="promotion-card-head"><h4>Nhà 25</h4><span class="operation-status">Đang chạy</span></div>
        <p>Đang chạy CTKM hàng tháng, kèm chương trình dành cho khách hàng đạt hạng <strong>Gold, Silver và Titan</strong>.</p>
      </article>
      <article class="promotion-card">
        <div class="promotion-card-head"><h4>Nhà 97</h4><span class="operation-status internal">Nội bộ</span></div>
        <p>CTKM hàng tháng kết hợp chương trình nội bộ. Phản hồi hiện tại: chương trình kém hấp dẫn vì chỉ được giảm giá cho <strong>hàng hệ số</strong>.</p>
      </article>
      <article class="promotion-card">
        <div class="promotion-card-head"><h4>Nhà 144</h4><span class="operation-status pending">Đang xin duyệt</span></div>
        <p>Đang xin duyệt CTKM hàng tháng cùng các combo: <strong>mẹ bầu, tăng đề kháng và bổ sung calci cho mẹ và bé</strong>.</p>
      </article>
    </div>
    <div class="operation-info-grid">
      <article class="operation-info"><h4>📦 Hàng hoá</h4><p>Đã lọc và bổ sung <strong>97% các mã hàng key</strong>. Thực hiện lọc hàng hết <strong>2 lần mỗi tuần</strong>.</p></article>
      <article class="operation-info"><h4>🤝 Chăm sóc khách hàng</h4><p>Hướng dẫn nhân viên lọc danh sách khách hàng cần ưu tiên chăm sóc và các chỉ tiêu dễ thăng hạng trên POS. Trong tháng đầu tiên, cố gắng tối ưu tỷ lệ chuyển đổi càng cao càng tốt theo KPI hệ thống đề ra.</p></article>
    </div>
  </section>
  <section id="ke-hoach-tuan-toi">
    <div class="section-title"><h2>🗓️ Kế hoạch tuần tới</h2><p>Các đầu việc ưu tiên theo từng nhà thuốc</p></div>
    <div class="next-week-grid">
      <article class="next-week-card"><h3>Nhà 25</h3><ul><li>Theo dõi <strong>doanh số chạy hàng cận date</strong>.</li><li>Tổng hợp <strong>số lượng khách tham gia chương trình member</strong>.</li></ul></article>
      <article class="next-week-card"><h3>Nhà 97</h3><ul><li>Theo dõi <strong>doanh số tạo ra từ chương trình nội bộ</strong>.</li><li>Giám sát <strong>doanh số chạy hàng cận date</strong>.</li></ul></article>
      <article class="next-week-card"><h3>Nhà 144</h3><ul><li>Chốt ngày khai trương dự kiến <strong>09–10/09</strong>.</li><li>Hoàn thiện <strong>chương trình khai trương</strong>.</li><li>Thực hiện kế hoạch <strong>giảm tồn kho nhà thuốc</strong>.</li></ul></article>
    </div>
  </section>
</main>
<footer>Hệ thống báo cáo UPHARMA • Dữ liệu tháng ${currentMonth}/${currentYear}</footer>
<script>
const rawEmployees = ${JSON.stringify(employeePlans)};
const rawShopPlans = ${JSON.stringify(shopPlans)};
const rawInventory = ${JSON.stringify(inventoryRows)};
const rawOrders = ${JSON.stringify(orderReportItems)};
const REPORT_DAY = ${now.getDate()}, DAYS_IN_MONTH = ${new Date(currentYear, currentMonth, 0).getDate()};

function pick(obj, keys) {
  if (!obj) return "";
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return "";
}

function parseNumericValue(val) {
  if (typeof val === "number") return val;
  if (!val) return 0;
  const cleaned = String(val).replace(/[^0-9.-]/g, "");
  return Number(cleaned) || 0;
}

function normalizeInventoryRow(row) {
  const productName = String(pick(row, ["ProductName", "Product_Name", "ProductFullName", "Product_Name_Full", "TenSP", "TenSanPham", "Name", "ItemName"])).trim();
  const expiry = pick(row, ["ExpDate", "ExpireDate", "ExpiredDate", "ExpiryDate", "ExpDateTxt", "ExpDateText", "ExpireDateTxt", "ExpiredDateTxt", "HanDung", "HSD", "DateExp", "DateExpired", "DateExpire", "UseDate", "ValidDate", "ShelfLifeDate", "LotExpireDate", "NgayHetHan", "NgayHSD"]);
  const productCode = String(pick(row, ["ProductCode", "ProductID", "Product_ID", "MaSP", "MaSanPham", "ItemCode", "Code"]));
  const shopCode = String(row["__shopCode"] || row["ShopCode"] || "");
  const price = pick(row, ["Price", "Gia", "GiaBan", "SalePrice", "RetailPrice", "UnitPrice", "PriceVAT", "PriceSell"]);
  const quantity = pick(row, ["Quantity", "Qty", "SL", "SoLuong", "InventoryQuantity", "StockQty", "TonKho", "RemainQty"]);
  
  const priceValue = parseNumericValue(price);
  const quantityValue = parseNumericValue(quantity);
  const stockValue = priceValue * quantityValue;
  
  return { productName, productCode, shopCode, price: priceValue, quantity: quantityValue, stockValue, expiry: expiry ? String(expiry).trim() : "" };
}

const shopCodes = Array.from(new Set([...rawEmployees.map(e => e.ShopCode), ...rawShopPlans.map(s => s.ShopCode)].filter(Boolean)));
const shops = shopCodes.map(code => {
  const shopEmps = rawEmployees.filter(e => e.ShopCode === code);
  const amount = shopEmps.reduce((sum, e) => sum + (e.Amount || 0), 0);
  const amountR = shopEmps.reduce((sum, e) => sum + (e.AmountR || 0), 0);
  const hhs = shopEmps.reduce((sum, e) => sum + (e.PointRatio || 0), 0);
  const hhsR = shopEmps.reduce((sum, e) => sum + (e.PointRatioR || 0), 0);
  const customers = shopEmps.reduce((sum, e) => sum + (e.QuantityCus || 0), 0);
  const customersR = shopEmps.reduce((sum, e) => sum + (e.QuantityCusR || 0), 0);
  const invoices = shopEmps.reduce((sum, e) => sum + (e.QuantityInvoice || 0), 0);
  const invoicesR = shopEmps.reduce((sum, e) => sum + (e.QuantityInvoiceR || 0), 0);
  const shopInv = rawInventory.filter(i => (i.__shopCode || i.ShopCode) === code).map(normalizeInventoryRow);
  const sku = new Set(shopInv.map(i => i.productCode).filter(Boolean)).size;
  const modified = new Date().toISOString().slice(0, 16).replace('T', ' ');
  let name = code;
  if (code === 'SHOP0025') name = 'Nhà thuốc số 25 - 170 Lê Đình Lý - Thanh Khê - Đà Nẵng';
  else if (code === 'SHOP0097') name = 'Nhà thuốc số 97 - 44 Nguyễn Lương Bằng, Liên Chiểu, Đà Nẵng';
  else if (code === 'SHOP0144') name = 'Nhà thuốc số 144 - 77-79 Lê Văn Hiến, Phường Ngũ Hành Sơn, Đà Nẵng';
  const short = code === 'SHOP0025' ? 'Nhà 25' : code === 'SHOP0097' ? 'Nhà 97' : code === 'SHOP0144' ? 'Nhà 144' : code.replace('SHOP00', 'Nhà ').replace('SHOP0', 'Nhà ');
  return { code, short, name, modified, amount, amountR, hhs, hhsR, sku, customers, customersR, invoices, invoicesR };
});

const inventoryByShop = {};
shopCodes.forEach(code => {
  const shopInv = rawInventory.filter(i => (i.__shopCode || i.ShopCode) === code).map(normalizeInventoryRow);
  const totalValue = shopInv.reduce((sum, i) => sum + i.stockValue, 0);
  const productSets = { all: new Set(), expired: new Set(), three: new Set(), six: new Set(), year: new Set(), normal: new Set() };
  const values = { all: 0, expired: 0, three: 0, six: 0, year: 0, normal: 0 };

  shopInv.forEach(item => {
    const pCode = (item.productCode || "").trim() || item.productName || Math.random().toString();
    productSets.all.add(pCode);
    values.all += item.stockValue;

    const today = new Date();
    const expDate = item.expiry ? new Date(item.expiry.replace(' ', 'T')) : null;
    if (!expDate || isNaN(expDate.getTime())) {
      productSets.normal.add(pCode);
      values.normal += item.stockValue;
      return;
    }

    const diffDays = Math.ceil((expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) {
      productSets.expired.add(pCode);
      values.expired += item.stockValue;
    }
    if (diffDays >= 0 && diffDays <= 90) {
      productSets.three.add(pCode);
      values.three += item.stockValue;
    }
    if (diffDays > 90 && diffDays <= 180) {
      productSets.six.add(pCode);
      values.six += item.stockValue;
    }
    if (diffDays >= 0 && diffDays <= 360) {
      productSets.year.add(pCode);
      values.year += item.stockValue;
    }
    if (diffDays > 360) {
      productSets.normal.add(pCode);
      values.normal += item.stockValue;
    }
  });

  const bins = {};
  ['all', 'expired', 'three', 'six', 'year', 'normal'].forEach(k => {
    const val = values[k];
    const rate = totalValue > 0 ? (val / totalValue) * 100 : 0;
    bins[k] = { count: productSets[k].size, value: val, rate: rate };
  });

  inventoryByShop[code] = { totalValue, ...bins };
});

const nearExpiryOrders = {};
shopCodes.forEach(code => nearExpiryOrders[code] = { '3': { total: 0, employees: [] }, '6': { total: 0, employees: [] }, '12': { total: 0, employees: [] } });
rawOrders.forEach(o => {
  const rowShop = o.ShopCode || o.__shopCode || o.BranchCode || o.StoreCode || o.Shop_Code;
  const shop = rowShop ? String(rowShop).trim() : "";
  if (!shop || !nearExpiryOrders[shop]) return;
  const empName = o.SalesName || o.EmployeeName || 'N/A';
  const val = parseNumericValue(o.Amount || o.ThanhTien);
  const expDate = o.ExpirationDate ? new Date(String(o.ExpirationDate).trim().replace(' ', 'T')) : null;
  if (!expDate || isNaN(expDate.getTime())) return;
  const orderDate = new Date(String(o.OrderDate || o.InvoiceDate || new Date()).trim().replace(' ', 'T'));
  const diffDays = Math.ceil((expDate.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return;
  const addValue = (r) => { 
    nearExpiryOrders[shop][r].total += val; 
    let emp = nearExpiryOrders[shop][r].employees.find(e => e.name === empName); 
    if (!emp) { 
      emp = { name: empName, value: 0 }; 
      nearExpiryOrders[shop][r].employees.push(emp); 
    } 
    emp.value += val; 
  };
  if (diffDays <= 90) { addValue('3'); addValue('6'); addValue('12'); } 
  else if (diffDays <= 180) { addValue('6'); addValue('12'); } 
  else if (diffDays <= 365) { addValue('12'); }
});

const employees = rawEmployees.map(emp => ({ shop: emp.ShopCode, name: emp.EmployeeName, code: emp.EmployeeCode, amount: emp.Amount || 0, amountR: emp.AmountR || 0, invoices: emp.QuantityInvoice || 0, invoicesR: emp.QuantityInvoiceR || 0, newCustomers: emp.QuantityCusNew || 0, newCustomersR: emp.QuantityCusNewR || 0, customers: emp.QuantityCus || 0, customersR: emp.QuantityCusR || 0, points: emp.PointRatio || 0, pointsR: emp.PointRatioR || 0 }));

let activeShop = shops[0]?.code || 'SHOP0025', activeInventory = shops[0]?.code || 'SHOP0025', activeOrderShop = shops[0]?.code || 'SHOP0025', activeOrderRange = '3', activeOrderEmployee = 'all';
const fmt = v => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(v || 0), pct = (a, t) => t ? Math.round(a / t * 100) : 0, project = v => Math.round((v || 0) / REPORT_DAY * DAYS_IN_MONTH), ratio = (p, a) => a ? Math.round(p * 1000 / a * 100) : 0, fmtRate = v => new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0) + '%';

function renderDashboard() {
  if (shops.length === 0) return;
  const totals = shops.reduce((a, s) => ({ amount: a.amount + s.amount, amountR: a.amountR + s.amountR, hhs: a.hhs + s.hhs, hhsR: a.hhsR + s.hhsR }), { amount: 0, amountR: 0, hhs: 0, hhsR: 0 });
  document.getElementById('dashboard-summary').innerHTML = \`
   <div class="summary-kpi"><span>Tổng doanh số thực tế</span><strong>\${fmt(totals.amountR)} đ</strong></div>
   <div class="summary-kpi"><span>Hoàn thành doanh số</span><strong>\${pct(totals.amountR, totals.amount)}%</strong></div>
   <div class="summary-kpi"><span>Tổng HHS thực tế</span><strong>\${fmt(totals.hhsR)}</strong></div>
   <div class="summary-kpi"><span>Hoàn thành HHS</span><strong>\${pct(totals.hhsR, totals.hhs)}%</strong></div>\`;
  document.getElementById('chart-area').innerHTML = shops.map(s => {
    const ds = pct(s.amountR, s.amount), hs = pct(s.hhsR, s.hhs);
    return \`<div class="store-group"><div class="bars">
    <div class="bar-item"><div class="bar-value">\${ds}%</div><div class="bar-track"><div class="bar bar-ds" style="height:\${Math.min(ds / 150 * 100, 100)}%"></div></div><div class="bar-label">DS thực tế</div></div>
    <div class="bar-item"><div class="bar-value">\${hs}%</div><div class="bar-track"><div class="bar bar-hhs" style="height:\${Math.min(hs / 150 * 100, 100)}%"></div></div><div class="bar-label">HHS thực tế</div></div>
   </div><div class="store-name">\${s.short}</div></div>\`;
  }).join('');
  document.getElementById('shop-cards').innerHTML = shops.map(s => {
    const ds = pct(s.amountR, s.amount), hs = pct(s.hhsR, s.hhs), w = ratio(s.hhsR, s.amountR);
    return \`<article class="shop-card"><div class="shop-card-head"><h3>\${s.short}</h3><div class="updated">\${s.code}<br>\${s.modified}</div></div>
    <div class="kpi-row"><div class="kpi-label">Doanh số</div><div class="kpi-cell"><span>Chỉ tiêu</span><strong>\${fmt(s.amount)} đ</strong></div><div class="kpi-cell"><span>Thực tế</span><strong>\${fmt(s.amountR)} đ</strong><small class="attainment">Đạt \${ds}%</small></div><div class="kpi-cell"><span>Dự kiến</span><strong>\${fmt(project(s.amountR))} đ</strong></div></div>
    <div class="kpi-row"><div class="kpi-label">HHS</div><div class="kpi-cell"><span>Chỉ tiêu</span><strong>\${fmt(s.hhs)}</strong></div><div class="kpi-cell"><span>Thực tế</span><strong>\${fmt(s.hhsR)}</strong><small class="attainment">Đạt \${hs}%</small></div><div class="kpi-cell"><span>Dự kiến</span><strong>\${fmt(project(s.hhsR * 1000))}</strong></div></div>
    <div class="ratio-metric"><span>Tỷ trọng HHS thực tế / Doanh số thực tế</span><strong>\${w}%</strong></div>
   </article>\`;
  }).join('');
}

function renderTabs() {
  if (shops.length === 0) return;
  document.getElementById('shop-tabs').innerHTML = shops.map(s => \`<button type="button" class="shop-tab \${s.code === activeShop ? 'active' : ''}" data-shop="\${s.code}"><strong>\${s.code}</strong><span>\${s.name}</span><small>\${employees.filter(e => e.shop === s.code).length} nhân viên</small></button>\`).join('');
  document.querySelectorAll('.shop-tab').forEach(b => b.addEventListener('click', () => { activeShop = b.dataset.shop; renderTabs(); renderEmployeeTable(); }));
}

function renderInventory() {
  const data = inventoryByShop[activeInventory];
  if (!data) return;
  const categories = [{ key: 'all', label: 'Tất cả', className: 'all' }, { key: 'expired', label: 'Hết hạn', className: 'expired' }, { key: 'three', label: '3 Tháng', className: 'three' }, { key: 'six', label: '6 Tháng', className: 'six' }, { key: 'year', label: '1 Năm', className: 'year' }, { key: 'normal', label: 'Hàng bình thường', className: 'normal' }];
  document.getElementById('inventory-total-value').textContent = fmt(data.totalValue) + ' VNĐ';
  document.getElementById('inventory-cards').innerHTML = categories.map(c => { const item = data[c.key]; return \`<article class="inventory-card \${c.className}"><span>\${c.label}</span><strong>\${fmt(item.count)}</strong><small>\${fmt(item.value)} VNĐ</small><em>\${fmtRate(item.rate)}</em></article>\`; }).join('');
  document.getElementById('inventory-shop-grid').innerHTML = shops.map(shop => \`<button type="button" class="inventory-shop \${shop.code === activeInventory ? 'active' : ''}" data-inventory-shop="\${shop.code}"><b>\${fmt(inventoryByShop[shop.code]?.all.count || 0)}</b><strong>\${shop.code}</strong><span>\${shop.name}</span></button>\`).join('');
  document.querySelectorAll('[data-inventory-shop]').forEach(b => b.addEventListener('click', () => { activeInventory = b.dataset.inventoryShop; renderInventory(); }));
}

function renderNearExpiryOrders() {
  const shopSelect = document.getElementById('expiry-order-shop');
  if (shops.length === 0) return;
  shopSelect.innerHTML = shops.map(s => \`<option value="\${s.code}" \${s.code === activeOrderShop ? 'selected' : ''}>\${s.code} - \${s.name}</option>\`).join('');
  shopSelect.onchange = (e) => { activeOrderShop = e.target.value; activeOrderEmployee = 'all'; renderNearExpiryOrders(); };
  document.getElementById('expiry-range-buttons').innerHTML = [{ v: '3', l: '3 tháng' }, { v: '6', l: '6 tháng' }, { v: '12', l: '12 tháng' }].map(r => \`<button type="button" class="range-btn \${r.v === activeOrderRange ? 'active' : ''}" data-expiry-range="\${r.v}">\${r.l}</button>\`).join('');
  document.querySelectorAll('[data-expiry-range]').forEach(b => b.addEventListener('click', () => { activeOrderRange = b.dataset.expiryRange; activeOrderEmployee = 'all'; renderNearExpiryOrders(); }));
  const data = nearExpiryOrders[activeOrderShop]?.[activeOrderRange];
  if (!data) { document.getElementById('expiry-employee-grid').innerHTML = '<div class="order-empty">Chưa có dữ liệu.</div>'; return; }
  document.getElementById('expiry-employee-count').textContent = \`\${data.employees.length} nhân viên\`;
  const cards = [{ id: 'all', name: 'Tất cả nhân viên', value: data.total }, ...data.employees.map((e, i) => ({ id: String(i), ...e }))];
  document.getElementById('expiry-employee-grid').innerHTML = cards.map(c => \`<button type="button" class="order-employee-card \${c.id === activeOrderEmployee ? 'active' : ''}" data-order-employee="\${c.id}"><span>\${c.name}</span><strong>\${fmt(c.value)} đ</strong></button>\`).join('');
  document.querySelectorAll('[data-order-employee]').forEach(b => b.addEventListener('click', () => { activeOrderEmployee = b.dataset.orderEmployee; renderNearExpiryOrders(); }));
}

function renderEmployeeTable() {
  const items = employees.filter(e => e.shop === activeShop), shop = shops.find(s => s.code === activeShop);
  if (!shop) return;
  document.getElementById('employee-caption').textContent = \`\${shop.name} · \${items.length} nhân viên\`;
  const actual = items.reduce((a, e) => a + e.amountR, 0), target = items.reduce((a, e) => a + e.amount, 0);
  document.getElementById('employee-table').innerHTML = \`<table><thead><tr><th>Nhân viên</th><th>Doanh số</th><th>Dự kiến</th><th>HHS</th><th>Dự kiến HHS</th><th>Tỷ trọng</th><th>Khách hàng</th><th>Khách mới</th><th>Đơn</th></tr></thead><tbody>\${items.map(e => \`<tr><td><div class="identity"><strong>\${e.name}</strong><span>\${e.code}</span></div></td><td><div class="cell-number"><strong>\${fmt(e.amountR)} đ</strong><span>Đạt \${pct(e.amountR, e.amount)}%</span></div></td><td><div class="cell-number"><strong>\${fmt(project(e.amountR))} đ</strong></div></td><td><div class="cell-number"><strong>\${fmt(e.pointsR)}</strong></div></td><td><div class="cell-number"><strong>\${fmt(project(e.pointsR))}</strong></div></td><td style="text-align:center"><span class="ratio-badge">\${ratio(e.pointsR, e.amountR)}%</span></td><td>\${fmt(e.customersR)}</td><td>\${fmt(e.newCustomersR)}</td><td>\${fmt(e.invoicesR)}</td></tr>\`).join('')}</tbody></table><div class="summary-line">Tổng DS: \${fmt(actual)} / \${fmt(target)} đ (\${pct(actual, target)}%)</div>\`;
}

document.getElementById('expiry-reset-btn').addEventListener('click', () => { activeOrderShop = shops[0]?.code || 'SHOP0025'; activeOrderRange = '3'; activeOrderEmployee = 'all'; renderNearExpiryOrders(); });
document.getElementById('view-btn').addEventListener('click', () => { alert('Dữ liệu tháng ' + document.getElementById('month-select').value + '/' + document.getElementById('year-select').value); });

renderDashboard(); renderInventory(); renderNearExpiryOrders(); renderTabs(); renderEmployeeTable();
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
