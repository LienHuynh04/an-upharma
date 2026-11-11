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

- Sign-in uses Firebase Authentication (email/password). In the app's login
  page, staff pick the **Nhân viên kiểm kê** tab and type a short username;
  the app maps it to the Firebase email `<username>@an-upharma.local`.
- After sign-in the app reads `staff_users/{uid}` in Realtime Database:
  `{ displayName, role, shops, pages, active }`. `role: "counter"` = staff,
  `role: "admin"` = the shared management account (below). `pages` is the
  list of route paths the account may open; the route guard and the menu
  enforce it, redirecting anything else to the first granted page.
- The hourly sync script writes `shop_catalog/{shopCode}` — products whose
  total stock at that shop is > 0, as `{ c, n, u }` items — plus
  `shop_catalog_index`. Database rules let a staff account read only the
  catalogs of its assigned shops.
- Finished count sheets are written to `count_submissions/{shopCode}/{id}`.
  Rules: staff can write only their own sheet and cannot read any submission;
  only the admin role can read them and write `count_final_reviews`.
- **Management account**: account management runs through one shared Firebase
  account, `quantri@an-upharma.local`, protected by a management password the
  manager sets on the accounts page itself. There is no per-manager Firebase
  account and nothing to create in the Console. The first unlock creates the
  account and claims the create-once `system_admin` node (database rules
  accept the claim only while the node does not exist), so exactly one
  management account can ever be bootstrapped this way; the accounts page can
  only be opened by a signed-in main (Upharma) account in the first place.

Scope note: page grants are enforced by the app (guard + menu). The
inventory-count data path is additionally enforced by database rules (slim
catalog per assigned shop, blind submissions). Other pages read data nodes
that are still public until Phase 4 below — so granting a staff account an
extra page means trusting that person with everything that page shows.

## Setup (one time)

1. **Enable Email/Password sign-in** (Firebase Console): Authentication →
   Sign-in method → Email/Password → Enable.
2. **Set the Web API key in the app**: Project settings → General → copy
   *Web API key*, paste it into `firebaseApiKey` in both
   `src/environments/environment.ts` and `src/environments/environment.prod.ts`,
   then rebuild/redeploy. (The key is a public project identifier, not a
   secret.) Until this is done, the staff tab shows a "not configured" error
   and manager login is unaffected.
3. **Deploy the database rules**: the rules in `database.rules.json` (which
   add `system_admin`, `staff_users`, `shop_catalog`, `shop_catalog_index`,
   `count_submissions`, `count_final_reviews`) must be the live rules —
   `firebase deploy --only database` or paste them in the console's Rules tab.
4. **Set the management password**: sign in as manager, open
   **Tài khoản kiểm kê** (top menu, next to Cài đặt) and enter a management
   password in the *Mở khóa quản lý tài khoản* form. Do this promptly after
   deploying — the management account goes to whoever unlocks first, then it
   is locked. Later visits on the same browser stay unlocked; a new browser
   asks for the password once. **Forgotten password**: delete the
   `system_admin` node and the `quantri` user in the Firebase Console, then
   set a new password here.
5. **Create staff accounts** on the same page: username, password, full name,
   the shops the person is responsible for, and the pages they may open
   (**Kiểm kê** is pre-selected). The page creates the Firebase user and its
   role record together. From the same page you can re-assign shops/pages
   (**Phân quyền**) or lock/unlock an account — locking revokes access
   immediately (the app refuses inactive accounts and the database rules stop
   serving them catalogs). Creating accounts manually in the console also
   still works: add the user in Authentication with email
   `<username>@an-upharma.local`, then create `staff_users/{uid}`:
   ```json
   { "username": "kiemke01", "displayName": "Tên nhân viên", "role": "counter",
     "shops": { "SHOP0025": true, "SHOP0097": true },
     "pages": ["kiem-ke"], "active": true }
   ```
   `shops` must be a map of shop code → `true` (not an array) — the database
   rules match on it. Deleting an account entirely, or resetting a forgotten
   staff password (the `@an-upharma.local` addresses cannot receive mail), is
   done in the Firebase Console.
6. **Generate the catalogs**: wait for the next hourly sync (or run
   `node scripts/fetch-upharma-data.js` once). Check `shop_catalog/` appears
   in Realtime Database.

## Daily use

- Staff open the app, choose **Nhân viên kiểm kê**, sign in, and land on the
  first page granted to them; the menu shows exactly their granted pages.
- Counting: pick the shop, open a count session, count, and press
  **Hoàn thành kiểm kê** — the sheet is submitted automatically; if there is
  no signal it stays on the device marked *Chưa nộp* and is resent on the
  next visit.
- On the shelf they may also add a product the shop catalog does not list
  (system stock zero): search finds it in the system-wide catalog and it is
  flagged *Ngoài danh mục shop* on the sheet and in the review.
- Manager: open Kiểm kê, pick the shop, press **Tải kết quả nhân viên nộp**
  (requires the management unlock from step 4). Rows where staff disagree are
  highlighted; type the final quantity per product in **SL chốt**, then
  **Lưu số chốt** and/or **Xuất Excel đối chiếu**.

## Phase 4 (prepared, not deployed)

`database.rules.phase4.json` additionally closes the long-standing public
reads of the full inventory (`shops/*/upharma_data`, `national_inventory_cache`)
and the public writes (`hidden_products`, `transfer_suggestions_cache`).
**Do not deploy it yet**: the manager app still reads those nodes without a
Firebase token on several pages. Deploy it only after every read/write path
in the app attaches the Firebase ID token, and test in the Rules Simulator
first, keeping the previous rules file for one-click rollback.
