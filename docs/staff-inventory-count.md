# Staff accounts with manager-assigned page access — setup guide

Goal: the manager creates staff accounts right inside the app and decides, per
account, **which shops** the person is responsible for and **which pages**
they may open (the inventory-count page by default; more operational pages can
be granted). On the inventory-count page a staff account only ever receives a
slim product list (code + name + unit) — system quantities and prices are
never sent to it. Several staff may count the same product at the same shop at
the same time on purpose (blind cross-checking): nobody sees anybody else's
counts; only the manager sees all counts side by side and confirms the final
quantity per product.

## How it works

- Accounts are **site-native**: no Firebase Authentication, no Web API key,
  no Firebase Console setup. The main (manager) account creates them on the
  **Tài khoản kiểm kê** page; they are stored in Realtime Database under
  `staff_accounts/{key}` (key = the username with RTDB-forbidden characters
  percent-encoded).
- Passwords are never stored in plain text: each account stores a salted
  **PBKDF2-SHA256** hash (120 000 iterations). Staff passwords must be at
  least 4 characters and should be used only for this app.
- Staff sign in on the login page's **Nhân viên kiểm kê** tab with the
  username and password the manager gave them. The app reads the account
  record, verifies the password against the stored hash in the browser, and
  keeps a session in localStorage — the same pattern as the main account.
- The record carries `shops` (map of shop code → `true`) and `pages` (list of
  route paths). **Page permission is enforced by the Angular route guard**
  (plus the menu, which shows exactly the granted pages): any other address
  redirects to the account's first granted page.
- The hourly sync script writes `shop_catalog/{shopCode}` — products whose
  total stock at that shop is > 0, as `{ c, n, u }` items — plus
  `shop_catalog_index`. In staff mode the count page loads only these slim
  catalogs for the account's shops.
- Finished count sheets are written to `count_submissions/{shopCode}/{id}`;
  the app never shows a staff member anyone else's sheet. The manager's
  confirmed quantities go to `count_final_reviews/{shopCode}/{id}`.

Honest limits of this design (accepted by the manager): enforcement is
app-level, not database-rule level — the login flow must be able to read the
stored hash to verify a password, so the hashes are readable by anyone who
knows the database address (the same posture the app already has for the
shop-visibility config). That is why staff passwords must be unique to this
app. Locking an account takes effect at its next sign-in. Tightening this
properly means per-user server-side auth and is tracked as future work, not
as part of this feature.

## Setup

There is exactly **one** requirement: the database rules must contain the
staff nodes (`staff_accounts`, `shop_catalog`, `shop_catalog_index`,
`count_submissions`, `count_final_reviews` — all in `database.rules.json`).

- **Automatic (normal path)**: the hourly sync script checks the live rules
  on every run and merges the staff nodes in if they are missing
  (`ensureStaffRules` in `scripts/fetch-upharma-data.js`). It only ever adds
  or updates those five nodes — every other rule is preserved byte for byte —
  and it is fail-open: if the rules endpoint rejects the change, the sync
  logs a warning and continues. Just wait for the next hourly sync after
  deploying this code (or trigger the workflow once).
- **Manual fallback**: if the accounts page still reports a rules error after
  a sync, paste `database.rules.json` into Firebase Console → Realtime
  Database → Rules → Publish, once.

Catalogs appear after the same sync run writes `shop_catalog/` — nothing
else to configure.

## Daily use

- Manager: open **Tài khoản kiểm kê**, fill in username, password (≥ 4
  characters), full name, the shops the person is responsible for, and the
  pages they may open (**Kiểm kê** is pre-selected), then **Tạo tài khoản**.
  Later, **Phân quyền** on a row re-assigns shops/pages and can also set a
  new password (leave the field empty to keep the current one);
  **Khóa / Mở khóa** enables or disables the account. Deleting an account
  entirely is not offered in the app — lock it instead.
- Staff: open the app, choose **Nhân viên kiểm kê**, sign in, and land on
  the first page granted to them; the menu shows exactly their granted pages.
- Counting: pick the shop, open a count session, count, and press
  **Hoàn thành kiểm kê** — the sheet is submitted automatically; if there is
  no signal it stays on the device marked *Chưa nộp* and is resent on the
  next visit.
- On the shelf they may also add a product the shop catalog does not list
  (system stock zero): search finds it in the system-wide catalog and it is
  flagged *Ngoài danh mục shop* on the sheet and in the review.
- Manager review: open Kiểm kê, pick the shop, press **Tải kết quả nhân viên
  nộp**. Rows where staff disagree are highlighted; type the final quantity
  per product in **SL chốt**, then **Lưu số chốt** and/or **Xuất Excel đối
  chiếu**.

## Phase 4 (prepared, not deployed)

`database.rules.phase4.json` additionally closes the long-standing public
reads of the full inventory (`shops/*/upharma_data`, `national_inventory_cache`)
and the public writes (`hidden_products`, `transfer_suggestions_cache`), while
keeping the staff nodes above exactly as they are. **Do not deploy it yet**:
the whole app (manager pages included) still reads those legacy nodes
anonymously, so closing them today would break the app; it needs a separate
authenticated-read design first. Test in the Rules Simulator before ever
deploying it, keeping the previous rules file for one-click rollback.
