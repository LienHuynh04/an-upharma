const { initializeApp, cert } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const nodemailer = require('nodemailer');

// 1. Kiểm tra môi trường
if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  console.error("LỖI: Thiếu biến môi trường FIREBASE_SERVICE_ACCOUNT_KEY");
  process.exit(1);
}

const EMAIL_RECEIVER = process.env.EMAIL_RECEIVER;
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

if (!EMAIL_RECEIVER || !SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
  console.error("LỖI: Thiếu cấu hình SMTP gửi nhận mail (EMAIL_RECEIVER, SMTP_HOST, SMTP_USER, SMTP_PASS)");
  process.exit(1);
}

// 2. Kết nối Firebase
let db = null;
try {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  const app = initializeApp({
    credential: cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
  });
  db = getDatabase(app);
  console.log("Kết nối Firebase thành công.");
} catch (err) {
  console.error("Lỗi kết nối Firebase:", err.message);
  process.exit(1);
}

async function run() {
  try {
    // 3. Tải danh sách tóm tắt cửa hàng
    console.log("Đang tải shops_summary...");
    const summarySnap = await db.ref('shops_summary').once('value');
    const summaryNode = summarySnap.val();
    if (!summaryNode || !summaryNode.data) {
      console.warn("Không tìm thấy dữ liệu shops_summary hoặc trống.");
      process.exit(0);
    }

    const summaryMap = summaryNode.data;
    const shopCodes = Object.keys(summaryMap);
    
    let totalOutOfStock = 0;
    const shopsDetailList = [];

    // 4. Duyệt qua từng shop để lấy chi tiết tất cả mặt hàng hết
    for (const sc of shopCodes) {
      const shopInfo = summaryMap[sc];
      const count = Number(shopInfo.outOfStockCount) || 0;
      totalOutOfStock += count;

      console.log(`Đang tải chi tiết hàng đã hết cho shop: ${sc}...`);
      const detailSnap = await db.ref(`shops/${sc}/upharma_data/out_of_stock_calculated`).once('value');
      const detailNode = detailSnap.val() || {};
      const items = Array.isArray(detailNode.data) ? detailNode.data : [];
      const shopName = (detailNode.shop && detailNode.shop.ShopName) ? detailNode.shop.ShopName : (shopInfo.shopName || sc);

      const allItems = items.map(item => {
        const rawStatus = (item.status || '').trim();
        const statusVal = (rawStatus === '' || rawStatus.toLowerCase() === 'rỗng') ? 'Chưa dự trù' : rawStatus;
        return {
          productCode: item.productCode || '',
          productName: item.productName || '',
          unit: item.unit || '',
          status: statusVal
        };
      });

      const plannedCount = allItems.filter(item => item.status === 'Đã dự trù').length;
      const unplannedCount = allItems.filter(item => item.status !== 'Đã dự trù').length;

      shopsDetailList.push({
        shopCode: sc,
        shopName,
        count,
        plannedCount,
        unplannedCount,
        items: allItems
      });
    }

    if (totalOutOfStock === 0) {
      console.log("Hôm nay không có sản phẩm nào hết hàng. Không gửi email.");
      process.exit(0);
    }

    // 5. Soạn nội dung HTML Email (Responsive & Modern)
    const todayStr = new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    
    // HTML tóm tắt các shop
    let summaryTableRows = '';
    let shopDetailHtml = '';

    for (const shop of shopsDetailList) {
      summaryTableRows += `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 12px; font-weight: bold; color: #1e293b;">${shop.shopCode}</td>
          <td style="padding: 12px; text-align: right; font-weight: bold; color: ${shop.count > 0 ? '#dc2626' : '#16a34a'};">
            ${shop.count} mã (${shop.plannedCount} Đã dự trù, ${shop.unplannedCount} Chưa dự trù)
          </td>
        </tr>
      `;

      if (shop.count > 0) {
        let itemRows = '';
        shop.items.forEach((item, idx) => {
          const isEven = idx % 2 === 1;
          const rowBg = isEven ? '#f8fafc' : '#ffffff';
          const isPlanned = item.status === 'Đã dự trù';
          const statusBadge = `<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; background-color: ${isPlanned ? '#dcfce7; color: #16a34a;' : '#fee2e2; color: #ef4444;'}">${item.status}</span>`;
          
          itemRows += `
            <tr style="border-bottom: 1px solid #f1f5f9; font-size: 13px; background-color: ${rowBg};">
              <td style="padding: 10px 8px; color: #334155; font-weight: 600;">${item.productCode}</td>
              <td style="padding: 10px 8px; color: #1e293b; line-height: 1.3;">${item.productName}</td>
              <td style="padding: 10px 8px; color: #64748b; text-align: center;">${item.unit}</td>
              <td style="padding: 10px 8px; text-align: center;">${statusBadge}</td>
            </tr>
          `;
        });

        shopDetailHtml += `
          <div style="margin-top: 24px; padding: 16px; background: #fff; border-radius: 8px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
            <h3 style="margin: 0 0 12px 0; color: #0284c7; font-size: 15px; border-left: 4px solid #0284c7; padding-left: 8px; margin-bottom: 12px;">
              ${shop.shopCode} (Có ${shop.count} mã đã hết - ${shop.plannedCount} Đã dự trù, ${shop.unplannedCount} Chưa dự trù)
            </h3>
            <div class="scroll-container" style="max-height: 380px; overflow-y: auto; overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
              <table style="width: 100%; border-collapse: collapse; text-align: left;">
                <thead>
                  <tr style="position: sticky; top: 0; background-color: #f1f5f9; border-bottom: 2px solid #cbd5e1; font-size: 11px; color: #475569; text-transform: uppercase; z-index: 10; letter-spacing: 0.5px;">
                    <th style="padding: 10px 8px; width: 100px; background-color: #f1f5f9; position: sticky; top: 0; font-weight: bold;">Mã SP</th>
                    <th style="padding: 10px 8px; background-color: #f1f5f9; position: sticky; top: 0; font-weight: bold;">Tên Sản Phẩm</th>
                    <th style="padding: 10px 8px; text-align: center; width: 70px; background-color: #f1f5f9; position: sticky; top: 0; font-weight: bold;">ĐVT</th>
                    <th style="padding: 10px 8px; text-align: center; width: 95px; background-color: #f1f5f9; position: sticky; top: 0; font-weight: bold;">Trạng Thái</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemRows}
                </tbody>
              </table>
            </div>
          </div>
        `;
      }
    }

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Cảnh báo hàng đã hết Upharma</title>
        <style>
          /* Tùy chỉnh thanh cuộn siêu mỏng cho các trình duyệt hỗ trợ */
          .scroll-container::-webkit-scrollbar {
            width: 6px;
            height: 6px;
          }
          .scroll-container::-webkit-scrollbar-track {
            background: #f8fafc;
            border-radius: 4px;
          }
          .scroll-container::-webkit-scrollbar-thumb {
            background: #cbd5e1;
            border-radius: 4px;
          }
          .scroll-container::-webkit-scrollbar-thumb:hover {
            background: #94a3b8;
          }
        </style>
      </head>
      <body style="margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b;">
        <div style="max-width: 650px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03); border: 1px solid #e2e8f0;">
          
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); padding: 24px; text-align: center; color: #ffffff;">
            <h1 style="margin: 0; font-size: 20px; font-weight: 800; letter-spacing: 0.5px;">BÁO CÁO HÀNG ĐÃ HẾT HÀNG NGÀY</h1>
            <p style="margin: 6px 0 0 0; font-size: 13px; opacity: 0.9;">Ngày gửi: ${todayStr} | UPHARMA System</p>
          </div>

          <!-- Content Body -->
          <div style="padding: 24px;">
            <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.5; color: #475569;">
              Xin chào chị quản lý, hệ thống đã quét tự động và nhận dạng thấy các nhà thuốc có tổng cộng <strong>${totalOutOfStock} mã sản phẩm</strong> đã hết hàng trong tháng này.
            </p>

            <!-- Tóm tắt số lượng -->
            <div style="background-color: #f8fafc; border-radius: 8px; padding: 16px; border: 1px solid #e2e8f0; margin-bottom: 24px;">
              <h2 style="margin: 0 0 12px 0; font-size: 14px; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">Tóm tắt trạng thái</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tbody>
                  ${summaryTableRows}
                </tbody>
              </table>
            </div>

            <!-- Nút CTA -->
            <div style="text-align: center; margin: 28px 0;">
              <a href="https://an-upharma.web.app/hang-da-het" target="_blank" style="display: inline-block; padding: 12px 28px; background-color: #0284c7; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px; box-shadow: 0 2px 4px rgba(2, 132, 199, 0.2); transition: background-color 0.2s;">
                Truy cập Dashboard xem chi tiết & Dự trù
              </a>
            </div>

            <!-- Chi tiết tất cả mã -->
            <h2 style="margin: 32px 0 12px 0; font-size: 15px; color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; font-weight: bold;">
              📋 Chi tiết tất cả mặt hàng hết
            </h2>
            ${shopDetailHtml}

          </div>

          <!-- Footer -->
          <div style="background-color: #f1f5f9; padding: 16px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b;">
            <p style="margin: 0 0 4px 0;">Đây là email tự động gửi từ hệ thống giám sát Upharma.</p>
            <p style="margin: 0;">Vui lòng không phản hồi trực tiếp vào email này.</p>
          </div>

        </div>
      </body>
      </html>
    `;

    // 6. Cấu hình Transporter và gửi mail
    console.log("Đang cấu hình SMTP Transporter...");
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // true cho port 465, false cho các cổng khác
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      }
    });

    console.log(`Đang gửi email tới địa chỉ: ${EMAIL_RECEIVER}...`);
    const info = await transporter.sendMail({
      from: `"Cảnh báo Upharma" <${SMTP_USER}>`,
      to: EMAIL_RECEIVER,
      subject: `[Cảnh báo] Báo cáo danh sách hàng đã hết ngày ${todayStr} - UPHARMA`,
      html: emailHtml
    });

    console.log("Email gửi thành công! Message ID:", info.messageId);
    process.exit(0);
  } catch (error) {
    console.error("Lỗi trong quá trình chạy script:", error);
    process.exit(1);
  }
}

run();

