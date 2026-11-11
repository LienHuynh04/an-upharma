# Staff inventory-count accounts — setup guide

Goal: give a few staff members their own accounts that can open **only** the
inventory-count page (Kiểm kê), for **only** the shops assigned to them, and
only ever receive a slim product list (code + name + unit). System quantities
and prices are never sent to a staff account. Several staff may count the same
product at the same shop at the same time on purpose (blind cross-checking):
nobody sees anybody else's counts; only the manager sees all counts side by
side and confirms the final quantity per product.

## How it works

- Sign-in uses Firebase Authentication (email/password). In the app's login
  page, staff pick the **Nhân viên kiểm kê** tab and type a short username;
  the app maps it to the Firebase email `<username>@an-upharma.local`.
- After sign-in the app reads `staff_users/{uid}` in Realtime Database:
  `{ displayName, role, shops, active }`. `role: "counter"` = staff,
  `role: "admin"` = manager's Firebase link account.
- The hourly sync script writes `shop_catalog/{shopCode}` — products whose
  total stock at that shop is > 0, as `{ c, n, u }` items — plus
  `shop_catalog_index`. Database rules let a staff account read only the
  catalogs of its assigned shops.
- Finished count sheets are written to `count_submissions/{shopCode}/{id}`.
  Rules: staff can write only their own sheet and cannot read any submission;
  only the admin role can read them and write `count_final_reviews`.
- The manager keeps signing in with the Upharma account exactly as before.
  Right after that login the app silently tries the same credentials against
  Firebase; if the manager's Firebase account (step 3) uses the same password,
  the review panel on the Kiểm kê page works with no extra step.

## Setup (one time, Firebase Console)

1. **Enable Email/Password sign-in**: Authentication → Sign-in method →
   Email/Password → Enable.
2. **Set the Web API key in the app**: Project settings → General → copy
   *Web API key*, paste it into `firebaseApiKey` in both
   `src/environments/environment.ts` and `src/environments/environment.prod.ts`,
   then rebuild/redeploy. (The key is a public project identifier, not a
   secret.) Until this is done, the staff tab shows a "not configured" error
   and manager login is unaffected.
3. **Create the manager's Firebase link account**: Authentication → Users →
   Add user with email `<your-upharma-username>@an-upharma.local` and the
   **same password as your Upharma login**. Then in Realtime Database create
   `staff_users/{that user's uid}`:
   ```json
   { "displayName": "Quản lý", "role": "admin", "shops": { "SHOP0025": true }, "active": true }
   ```
4. **Create each staff account**: Authentication → Users → Add user with
   email `<username>@an-upharma.local` (e.g. `kiemke01@an-upharma.local`) and
   a password you hand to that person. Then create `staff_users/{uid}`:
   ```json
   { "displayName": "Tên nhân viên", "role": "counter",
     "shops": { "SHOP0025": true, "SHOP0097": true }, "active": true }
   ```
   `shops` must be a map of shop code → `true` (not an array) — the database
   rules match on it. To revoke access, set `active: false` (and/or disable
   the user in Authentication).
5. **Deploy the database rules**: the rules in `database.rules.json` (which
   add `staff_users`, `shop_catalog`, `shop_catalog_index`,
   `count_submissions`, `count_final_reviews`) must be the live rules —
   `firebase deploy --only database` or paste them in the console's Rules tab.
6. **Generate the catalogs**: wait for the next hourly sync (or run
   `node scripts/fetch-upharma-data.js` once). Check `shop_catalog/` appears
   in Realtime Database.

## Daily use

- Staff open the app, choose **Nhân viên kiểm kê**, sign in, pick their shop,
  open a count session, count, and press **Hoàn thành kiểm kê** — the sheet is
  submitted automatically; if there is no signal it stays on the device marked
  *Chưa nộp* and is resent on the next visit.
- On the shelf they may also add a product the shop catalog does not list
  (system stock zero): search finds it in the system-wide catalog and it is
  flagged *Ngoài danh mục shop* on the sheet and in the review.
- Manager: open Kiểm kê, pick the shop, press **Tải kết quả nhân viên nộp**.
  Rows where staff disagree are highlighted; type the final quantity per
  product in **SL chốt**, then **Lưu số chốt** and/or **Xuất Excel đối chiếu**.

## Phase 4 (prepared, not deployed)

`database.rules.phase4.json` additionally closes the long-standing public
reads of the full inventory (`shops/*/upharma_data`, `national_inventory_cache`)
and the public writes (`hidden_products`, `transfer_suggestions_cache`).
**Do not deploy it yet**: the manager app still reads those nodes without a
Firebase token on several pages. Deploy it only after every read/write path
in the app attaches the Firebase ID token, and test in the Rules Simulator
first, keeping the previous rules file for one-click rollback.
