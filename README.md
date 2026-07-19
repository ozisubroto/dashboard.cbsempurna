# CBS Sales Performance Dashboard

Dashboard interaktif Selling In / Selling Out untuk PT. Cahaya Bintang Sempurna.
Frontend: React + Vite + Tailwind + Recharts.
Backend: Express kecil yang menyimpan data secara **permanen** di server, sehingga
admin bisa mengganti database lewat menu **Upload Data** di dashboard tanpa perlu
menyentuh GitHub sama sekali.

## Arsitektur singkat

- `src/` — kode React (frontend), di-build jadi folder `dist/`.
- `server.js` — server Express yang:
  1. Menyajikan file-file di `dist/` (frontend hasil build)
  2. Menyediakan API:
     - `GET /api/data` — dashboard mengambil data terbaru dari sini
     - `POST /api/data` — dipanggil oleh menu Upload Data (khusus admin) untuk menyimpan data baru
- `public/data/dashboard-data.json` — data awal ("seed"), dipakai untuk mengisi
  penyimpanan permanen saat server pertama kali dijalankan.

## Menjalankan secara lokal

```bash
npm install
npm run build     # build frontend -> dist/
npm start         # jalankan server Express (menyajikan dist/ + API) di $PORT
```

Buka `http://localhost:8080` (atau port di `$PORT`).

Untuk development frontend saja dengan hot-reload (tanpa backend):
```bash
npm run dev
```
Catatan: mode ini tidak bisa memanggil `/api/data`, jadi menu Upload tidak akan berfungsi
saat pakai `npm run dev`. Untuk mencoba alur upload secara utuh, gunakan `npm run build && npm start`.

Akun demo:
- Admin (bisa upload data): `admin` / `admin123`
- Viewer (lihat saja): `view` / `view123`

## Deploy ke Railway via GitHub

1. Push seluruh isi folder ini ke sebuah repo GitHub.
2. Di Railway: **New Project → Deploy from GitHub repo**, pilih repo tersebut.
3. Railway (Nixpacks) otomatis menjalankan `npm install` → `npm run build` → `npm start`.

### PENTING — supaya data tidak hilang saat redeploy: tambahkan Volume

Tanpa Volume, data yang di-upload lewat dashboard tetap tersimpan selama service
berjalan (survive restart biasa), tapi akan **reset ke data awal setiap kali ada
deploy baru** (misalnya saat Anda push perubahan kode lain di kemudian hari).
Supaya benar-benar permanen walau ada deploy baru:

1. Buka service di Railway → tab **Settings** → bagian **Volumes**
2. Klik **New Volume**, isi:
   - Mount path: `/data`
3. Ke tab **Variables**, tambahkan environment variable:
   - `DATA_DIR` = `/data`
4. Redeploy sekali agar variable terbaca. Setelah itu, semua upload lewat menu
   Upload Data akan tersimpan di Volume tersebut dan tidak akan hilang lagi walau
   ada deploy berikutnya.

### Keamanan upload

Endpoint `POST /api/data` dilindungi token sederhana (header `x-upload-token`).
Defaultnya `cbs-admin-2026` (sudah dikodekan baik di `server.js` maupun `src/App.jsx`).
Jika ingin menggantinya:
1. Set environment variable `UPLOAD_TOKEN` di Railway ke nilai baru
2. Ubah juga konstanta `UPLOAD_TOKEN` di `src/App.jsx` (baris paling atas) ke nilai yang sama
3. Build ulang & deploy

Ini bukan sistem autentikasi tingkat lanjut (cocok untuk tim internal), bukan pengganti
autentikasi pengguna yang sesungguhnya.

## Struktur file

```
├── server.js          # backend Express (API + serve frontend)
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── public/
│   └── data/
│       └── dashboard-data.json   # data awal / seed
└── src/
    ├── main.jsx
    ├── index.css
    └── App.jsx          # seluruh logika & UI dashboard
```
