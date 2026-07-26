# UPHARMA Angular Inventory

Source hien tai da chuyen dashboard sang Angular.

- `src/`: Angular app, UI ton kho, menu, n8n demo, service goi API UPHARMA.
- `frontend/`: ban HTML/CSS/JS cu, giu lai de tham khao, khong con la thu muc deploy.
- `backend/`: Node.js API tuy chon cho n8n/server-side.
- `n8n/`: Docker Compose de chay n8n local.

## Yeu cau

- Node.js 20 tro len.
- Firebase CLI neu muon deploy Hosting.
- Docker Desktop neu muon chay n8n.

## Chay backend proxy/cache

Frontend hien tai goi API noi bo:

```txt
http://localhost:3000/api/upharma
```

Backend se goi API goc UPHARMA, cache ket qua vao `backend/.cache/`, roi tra ve cho Angular. Cach nay giup web nhanh hon va tranh viec browser goi qua nhieu API goc.

Tao file env:

```bash
cp backend/.env.example backend/.env
```

Cap nhat tai khoan trong `backend/.env` neu can chay cac route backend tu dong.

Chay backend:

```bash
npm run backend
```

## Chay Angular

Lan dau cai package:

```bash
npm install
```

Chay local:

```bash
npm start
```

Mo trinh duyet:

```txt
http://127.0.0.1:4200/
```

Angular app se login thong qua backend proxy:

```txt
http://localhost:3000/api/upharma/login
```

Sau do cac trang goi backend proxy/cache:

```txt
/api/upharma/resource
/api/upharma/call
```

Config API nam tai:

```txt
src/environments/environment.ts
```

Khi deploy public, doi `apiBaseUrl` trong `src/environments/environment.ts` sang URL backend public.

## Build

```bash
npm run build
```

Output deploy:

```txt
dist/upharma/browser
```

## Public len Firebase Hosting

`firebase.json` da tro Hosting vao `dist/upharma/browser`.

1. Build Angular:

```bash
npm run build
```

2. Dang nhap Firebase:

```bash
npx firebase-tools@latest login
```

3. Gan project:

```bash
npx firebase-tools@latest use --add
```

4. Deploy:

```bash
npx firebase-tools@latest deploy --only hosting
```

Website se co dang:

```txt
https://PROJECT_ID.web.app
```

## Chay n8n

```bash
cd n8n
docker compose up -d
```

Mo n8n:

```txt
http://localhost:5678
```

Tai khoan demo:

```txt
user: admin
password: admin123
```
# an-upharma
