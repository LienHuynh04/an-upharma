import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { STAFF_PAGE_OPTIONS, StaffAuthService, StaffUserRecord } from "../staff-auth.service";
import { ShopInfo, UpharmaService } from "../upharma.service";

/**
 * Manager page for staff accounts.
 *
 * The main (manager) account creates staff accounts here instead of using the
 * Firebase Console: the page signs the new user up through Firebase Auth and
 * writes its role record (assigned shops, granted pages, active flag) to
 * `staff_users`. The page itself is unlocked with a shared management
 * password (see StaffAuthService.unlockManagement) — no per-manager Firebase
 * account is involved. Deleting an account entirely and resetting a forgotten
 * password still happen in the Firebase Console; deactivating here is enough
 * to revoke access immediately.
 */
@Component({
  selector: "app-staff-admin",
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="page-header d-print-none">
      <div class="container-xl">
        <div class="row g-2 align-items-center">
          <div class="col">
            <div class="page-pretitle">QUẢN TRỊ</div>
            <h2 class="page-title">Tài khoản nhân viên kiểm kê</h2>
          </div>
        </div>
      </div>
    </div>

    <div class="page-body">
      <div class="container-xl">
        <div class="alert alert-danger" role="alert" *ngIf="errorText">{{ errorText }}</div>
        <div class="alert alert-success" role="status" *ngIf="noticeText">{{ noticeText }}</div>

        <div class="card mb-3" *ngIf="!isAdminLinked">
          <div class="card-header">
            <h3 class="card-title">Mở khóa quản lý tài khoản</h3>
          </div>
          <div class="card-body">
            <p class="text-secondary">
              Để tạo và quản lý tài khoản nhân viên, trang này dùng một <strong>tài khoản quản trị Firebase</strong>
              riêng — bạn chỉ cần đặt một mật khẩu quản trị ngay tại đây, không cần vào Firebase Console và không
              liên quan tới mật khẩu Upharma của bạn. Lần đầu nhập là hệ thống tự tạo tài khoản quản trị với mật
              khẩu đó; các lần sau nhập đúng mật khẩu để mở khóa (phiên mở khóa được ghi nhớ trên trình duyệt này).
              <strong>Hãy đặt mật khẩu quản trị ngay khi thấy form này</strong> — tài khoản quản trị chỉ tạo được một
              lần duy nhất, ai đặt trước thì người đó giữ (đặt lại chỉ được khi xóa thủ công trong Firebase Console).
            </p>
            <form (ngSubmit)="unlockManagement()">
              <div class="row g-3">
                <div class="col-md-4">
                  <label class="form-label" for="admin-password">Mật khẩu quản trị</label>
                  <input
                    id="admin-password"
                    class="form-control"
                    type="password"
                    [(ngModel)]="adminPassword"
                    name="adminPassword"
                    placeholder="Đặt mới hoặc nhập lại (ít nhất 6 ký tự)"
                    autocomplete="current-password"
                    required
                  />
                </div>
                <div class="col-md-4 d-flex align-items-end">
                  <button class="btn btn-primary" type="submit" [disabled]="unlocking">
                    <i class="ti ti-lock-open me-1" aria-hidden="true"></i>{{ unlocking ? "Đang mở khóa…" : "Mở khóa quản lý tài khoản" }}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>

        <ng-container *ngIf="isAdminLinked">
          <div class="card mb-3">
            <div class="card-header">
              <h3 class="card-title">Tạo tài khoản nhân viên mới</h3>
            </div>
            <div class="card-body">
              <form (ngSubmit)="createStaff()">
                <div class="row g-3">
                  <div class="col-md-3">
                    <label class="form-label" for="staff-username">Tên đăng nhập</label>
                    <input
                      id="staff-username"
                      class="form-control"
                      [(ngModel)]="newUsername"
                      name="newUsername"
                      placeholder="vd: kiemke01"
                      autocomplete="off"
                      required
                    />
                    <small class="form-hint">Chữ thường, số, dấu . _ - — nhân viên gõ đúng tên này ở tab "Nhân viên kiểm kê".</small>
                  </div>
                  <div class="col-md-3">
                    <label class="form-label" for="staff-password">Mật khẩu</label>
                    <input
                      id="staff-password"
                      class="form-control"
                      type="text"
                      [(ngModel)]="newPassword"
                      name="newPassword"
                      placeholder="Ít nhất 6 ký tự"
                      autocomplete="off"
                      required
                    />
                    <small class="form-hint">Đặt rồi đưa trực tiếp cho nhân viên.</small>
                  </div>
                  <div class="col-md-3">
                    <label class="form-label" for="staff-name">Họ tên nhân viên</label>
                    <input
                      id="staff-name"
                      class="form-control"
                      [(ngModel)]="newDisplayName"
                      name="newDisplayName"
                      placeholder="vd: Nguyễn Văn A"
                      autocomplete="off"
                      required
                    />
                    <small class="form-hint">Tên này hiện trên phiếu kiểm kê đã nộp.</small>
                  </div>
                  <div class="col-md-3">
                    <label class="form-label">Shop phụ trách</label>
                    <div class="d-flex flex-wrap gap-2 pt-1">
                      <label class="form-check form-check-inline" *ngFor="let shop of shops">
                        <input
                          class="form-check-input"
                          type="checkbox"
                          [(ngModel)]="newShops[shop.ShopCode]"
                          [ngModelOptions]="{ standalone: true }"
                        />
                        <span class="form-check-label">{{ shop.ShopCode }}</span>
                      </label>
                    </div>
                  </div>
                </div>
                <div class="row g-3 mt-1">
                  <div class="col-12">
                    <label class="form-label">Trang được xem</label>
                    <div class="d-flex flex-wrap gap-2 pt-1">
                      <label class="form-check form-check-inline" *ngFor="let option of pageOptions">
                        <input
                          class="form-check-input"
                          type="checkbox"
                          [(ngModel)]="newPages[option.path]"
                          [ngModelOptions]="{ standalone: true }"
                        />
                        <span class="form-check-label">{{ option.label }}</span>
                      </label>
                    </div>
                    <small class="form-hint">Nhân viên chỉ thấy đúng các trang được tick ở menu và khi gõ địa chỉ trực tiếp. Các trang quản trị (Cài đặt, Tài khoản kiểm kê, Báo cáo, Chỉ tiêu) không cấp cho nhân viên.</small>
                  </div>
                </div>
                <div class="mt-3">
                  <button class="btn btn-primary" type="submit" [disabled]="saving">
                    <i class="ti ti-user-plus me-1" aria-hidden="true"></i>{{ saving ? "Đang tạo…" : "Tạo tài khoản" }}
                  </button>
                </div>
              </form>
            </div>
          </div>

          <div class="card">
            <div class="card-header d-flex flex-wrap align-items-center justify-content-between gap-2">
              <h3 class="card-title">Danh sách tài khoản ({{ users.length }})</h3>
              <button class="btn btn-outline-primary btn-sm" type="button" (click)="loadUsers()" [disabled]="loading">
                <i class="ti ti-refresh me-1" aria-hidden="true"></i>{{ loading ? "Đang tải…" : "Tải lại" }}
              </button>
            </div>
            <div class="table-responsive" *ngIf="users.length; else emptyUsers">
              <table class="table table-vcenter card-table table-striped table-hover">
                <thead>
                  <tr>
                    <th>Tên đăng nhập</th>
                    <th>Họ tên</th>
                    <th>Vai trò</th>
                    <th>Shop phụ trách</th>
                    <th>Trang được xem</th>
                    <th>Trạng thái</th>
                    <th class="text-end">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  <tr *ngFor="let user of users">
                    <td class="fw-semibold">{{ user.username || "—" }}</td>
                    <td>{{ user.displayName || "—" }}</td>
                    <td>
                      <span class="badge" [class.bg-purple-lt]="user.role === 'admin'" [class.text-purple]="user.role === 'admin'" [class.bg-primary-lt]="user.role !== 'admin'" [class.text-primary]="user.role !== 'admin'">
                        {{ user.role === "admin" ? "Quản lý" : "Nhân viên kiểm kê" }}
                      </span>
                    </td>
                    <td>
                      <ng-container *ngIf="editingUid !== user.uid">
                        <span class="badge bg-secondary-lt me-1" *ngFor="let code of user.shops">{{ code }}</span>
                        <span class="text-secondary small" *ngIf="!user.shops.length">Chưa phân shop</span>
                      </ng-container>
                      <div class="d-flex flex-wrap gap-2" *ngIf="editingUid === user.uid">
                        <label class="form-check form-check-inline" *ngFor="let shop of shops">
                          <input
                            class="form-check-input"
                            type="checkbox"
                            [(ngModel)]="editShops[shop.ShopCode]"
                            [ngModelOptions]="{ standalone: true }"
                          />
                          <span class="form-check-label">{{ shop.ShopCode }}</span>
                        </label>
                      </div>
                    </td>
                    <td>
                      <ng-container *ngIf="editingUid !== user.uid">
                        <span class="badge bg-blue-lt text-blue me-1" *ngFor="let page of user.pages">{{ pageLabel(page) }}</span>
                        <span class="text-secondary small" *ngIf="!user.pages.length">—</span>
                      </ng-container>
                      <div class="d-flex flex-wrap gap-2" *ngIf="editingUid === user.uid">
                        <label class="form-check form-check-inline" *ngFor="let option of pageOptions">
                          <input
                            class="form-check-input"
                            type="checkbox"
                            [(ngModel)]="editPages[option.path]"
                            [ngModelOptions]="{ standalone: true }"
                          />
                          <span class="form-check-label">{{ option.label }}</span>
                        </label>
                      </div>
                    </td>
                    <td>
                      <span class="badge" [class.bg-success-lt]="user.active" [class.text-success]="user.active" [class.bg-danger-lt]="!user.active" [class.text-danger]="!user.active">
                        {{ user.active ? "Đang hoạt động" : "Đã khóa" }}
                      </span>
                    </td>
                    <td class="text-end">
                      <div class="btn-list flex-nowrap justify-content-end" *ngIf="user.role !== 'admin'">
                        <ng-container *ngIf="editingUid !== user.uid">
                          <button class="btn btn-sm btn-outline-primary" type="button" (click)="startEditShops(user)">Phân quyền</button>
                          <button
                            class="btn btn-sm"
                            [class.btn-outline-danger]="user.active"
                            [class.btn-outline-success]="!user.active"
                            type="button"
                            (click)="toggleActive(user)"
                          >{{ user.active ? "Khóa" : "Mở khóa" }}</button>
                        </ng-container>
                        <ng-container *ngIf="editingUid === user.uid">
                          <button class="btn btn-sm btn-primary" type="button" (click)="saveShops(user)" [disabled]="saving">Lưu</button>
                          <button class="btn btn-sm btn-ghost-secondary" type="button" (click)="editingUid = ''">Hủy</button>
                        </ng-container>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <ng-template #emptyUsers>
              <div class="card-body text-center text-secondary">
                {{ loading ? "Đang tải danh sách…" : "Chưa có tài khoản nào. Tạo tài khoản đầu tiên ở form phía trên." }}
              </div>
            </ng-template>
            <div class="card-footer text-secondary small">
              Khóa tài khoản là thu hồi quyền kiểm kê ngay (nhân viên không đăng nhập đếm tiếp được).
              Xóa hẳn tài khoản hoặc đặt lại mật khẩu khi nhân viên quên: làm trong Firebase Console → Authentication.
            </div>
          </div>
        </ng-container>
      </div>
    </div>
  `,
})
export class StaffAdminComponent implements OnInit {
  shops: ShopInfo[] = [];
  users: StaffUserRecord[] = [];
  loading = false;
  saving = false;
  errorText = "";
  noticeText = "";

  newUsername = "";
  newPassword = "";
  newDisplayName = "";
  newShops: Record<string, boolean> = {};
  newPages: Record<string, boolean> = { "kiem-ke": true };

  editingUid = "";
  editShops: Record<string, boolean> = {};
  editPages: Record<string, boolean> = {};

  adminPassword = "";
  unlocking = false;

  readonly pageOptions = STAFF_PAGE_OPTIONS;

  constructor(
    private readonly upharmaService: UpharmaService,
    private readonly staffAuthService: StaffAuthService,
  ) {}

  get isAdminLinked(): boolean {
    return this.staffAuthService.isAdmin();
  }

  async ngOnInit(): Promise<void> {
    this.shops = this.upharmaService.getActiveShops();
    await this.loadUsers();
  }

  /**
   * Unlocks account management with the shared management password: the first
   * unlock creates the management account, later unlocks sign in with it.
   */
  async unlockManagement(): Promise<void> {
    if (this.unlocking) return;
    if (!this.adminPassword) {
      this.errorText = "Nhập mật khẩu quản trị để mở khóa.";
      return;
    }
    this.unlocking = true;
    this.errorText = "";
    this.noticeText = "";
    try {
      const session = this.upharmaService.getSession();
      const displayName = session?.UserInfo?.FullName || "Quản trị";
      const shops = this.upharmaService.getActiveShops().map((shop) => shop.ShopCode);
      await this.staffAuthService.unlockManagement({
        password: this.adminPassword,
        displayName,
        shops,
      });
      this.adminPassword = "";
      this.noticeText =
        "Đã mở khóa quản lý tài khoản. Từ giờ bạn tạo và phân quyền tài khoản nhân viên ngay tại trang này.";
      await this.loadUsers();
    } catch (error) {
      this.errorText = this.messageOf(error);
    } finally {
      this.unlocking = false;
    }
  }

  async loadUsers(): Promise<void> {
    if (!this.isAdminLinked || this.loading) return;
    this.loading = true;
    this.errorText = "";
    try {
      this.users = await this.staffAuthService.listStaffUsers();
    } catch (error) {
      this.errorText = this.messageOf(error);
    } finally {
      this.loading = false;
    }
  }

  async createStaff(): Promise<void> {
    if (this.saving) return;
    const selectedShops = this.shops
      .map((shop) => shop.ShopCode)
      .filter((code) => this.newShops[code]);
    const selectedPages = this.pageOptions
      .map((option) => option.path)
      .filter((path) => this.newPages[path]);
    if (!this.newUsername.trim() || !this.newPassword || !this.newDisplayName.trim()) {
      this.errorText = "Điền đủ tên đăng nhập, mật khẩu và họ tên nhân viên.";
      return;
    }
    if (selectedShops.length === 0) {
      this.errorText = "Chọn ít nhất một shop cho nhân viên.";
      return;
    }
    if (selectedPages.length === 0) {
      this.errorText = "Chọn ít nhất một trang cho nhân viên xem.";
      return;
    }
    this.saving = true;
    this.errorText = "";
    this.noticeText = "";
    try {
      const created = await this.staffAuthService.createStaffAccount({
        username: this.newUsername,
        password: this.newPassword,
        displayName: this.newDisplayName,
        shops: selectedShops,
        pages: selectedPages,
      });
      this.noticeText = `Đã tạo tài khoản "${created.username}" cho ${created.displayName}. Nhân viên đăng nhập ở tab "Nhân viên kiểm kê" bằng tên đăng nhập và mật khẩu bạn vừa đặt.`;
      this.newUsername = "";
      this.newPassword = "";
      this.newDisplayName = "";
      this.newShops = {};
      this.newPages = { "kiem-ke": true };
      await this.loadUsers();
    } catch (error) {
      this.errorText = this.messageOf(error);
    } finally {
      this.saving = false;
    }
  }

  async toggleActive(user: StaffUserRecord): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.errorText = "";
    this.noticeText = "";
    try {
      const updated = { ...user, active: !user.active };
      await this.staffAuthService.updateStaffUser(updated);
      this.users = this.users.map((item) => (item.uid === user.uid ? updated : item));
      this.noticeText = updated.active
        ? `Đã mở khóa tài khoản "${user.username || user.displayName}".`
        : `Đã khóa tài khoản "${user.username || user.displayName}".`;
    } catch (error) {
      this.errorText = this.messageOf(error);
    } finally {
      this.saving = false;
    }
  }

  startEditShops(user: StaffUserRecord): void {
    this.editingUid = user.uid;
    this.editShops = {};
    for (const shop of this.shops) {
      this.editShops[shop.ShopCode] = user.shops.includes(shop.ShopCode);
    }
    this.editPages = {};
    for (const option of this.pageOptions) {
      this.editPages[option.path] = user.pages.includes(option.path);
    }
  }

  async saveShops(user: StaffUserRecord): Promise<void> {
    if (this.saving) return;
    const selectedShops = this.shops
      .map((shop) => shop.ShopCode)
      .filter((code) => this.editShops[code]);
    const selectedPages = this.pageOptions
      .map((option) => option.path)
      .filter((path) => this.editPages[path]);
    if (selectedShops.length === 0) {
      this.errorText = "Chọn ít nhất một shop, hoặc khóa tài khoản nếu nhân viên không còn phụ trách shop nào nữa.";
      return;
    }
    if (selectedPages.length === 0) {
      this.errorText = "Chọn ít nhất một trang cho nhân viên xem.";
      return;
    }
    this.saving = true;
    this.errorText = "";
    try {
      const updated = { ...user, shops: selectedShops, pages: selectedPages };
      await this.staffAuthService.updateStaffUser(updated);
      this.users = this.users.map((item) => (item.uid === user.uid ? updated : item));
      this.editingUid = "";
      this.noticeText = `Đã cập nhật phân quyền cho "${user.username || user.displayName}".`;
    } catch (error) {
      this.errorText = this.messageOf(error);
    } finally {
      this.saving = false;
    }
  }

  pageLabel(path: string): string {
    return this.pageOptions.find((option) => option.path === path)?.label || path;
  }

  private messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
