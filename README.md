# CBS Sales Performance Dashboard

Dashboard interaktif Selling In / Selling Out untuk PT. Cahaya Bintang Sempurna.
Dibangun dengan React + Vite + Tailwind + Recharts. Data awal (dari `Database_SI-SO.xlsx`)
sudah tertanam di `src/App.jsx`; pengguna dengan akun admin bisa mengunggah file Excel baru
langsung dari browser (diproses di client, tanpa backend/database eksternal).

## Menjalankan secara lokal

```bash
npm install
npm run dev
```

Buka `http://localhost:5173`.

Akun demo:
- Admin (bisa upload data): `admin` / `admin123`
- Viewer (lihat saja): `view` / `view123`

## Build production

```bash
npm run build     # menghasilkan folder dist/
npm start         # menjalankan hasil build (vite preview) di $PORT
```

## Deploy ke Railway via GitHub

1. Push seluruh isi folder ini (bukan hanya `src/App.jsx`) ke sebuah repo GitHub baru.
2. Di Railway: **New Project → Deploy from GitHub repo**, pilih repo tersebut.
3. Railway (Nixpacks) otomatis mendeteksi Node.js, menjalankan:
   - Install: `npm install`
   - Build: `npm run build`
   - Start: `npm start` (script ini otomatis membaca `$PORT` dari Railway)
4. Tunggu deploy selesai, lalu buka domain yang diberikan Railway.

Tidak perlu mengatur environment variable tambahan — `PORT` disediakan otomatis oleh Railway
dan sudah ditangani oleh script `start`.

## Struktur file

```
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── src/
│   ├── main.jsx      # entry point React
│   ├── index.css     # Tailwind + base styles
│   └── App.jsx        # seluruh logika & UI dashboard + data default (embedded)
└── README.md
```

## Catatan

- Login saat ini adalah autentikasi sisi-client (untuk demo/prototipe), bukan sistem
  autentikasi server. Untuk produksi sesungguhnya, ganti dengan auth backend yang layak.
- Data yang diunggah lewat menu Upload hanya tersimpan di memori browser selama sesi
  berjalan (tidak ada database/persisted storage). Refresh halaman akan mengembalikan ke
  data default yang ada di `src/App.jsx`.
