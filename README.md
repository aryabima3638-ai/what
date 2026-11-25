# SC FLUTTER BUILDER PRO

Telegram bot Node.js untuk Pterodactyl. Proses compile Flutter/Web dilakukan oleh GitHub Actions, bukan di container panel.

## Persyaratan

- Pterodactyl egg Node.js, Node 20+.
- Bot Telegram dari @BotFather.
- Channel Telegram publik atau bot dijadikan admin channel (izin membaca anggota dan mengirim pesan).
- Repository GitHub untuk builder, branch `main`.
- GitHub token dengan akses repository Contents (read/write), Actions (read/write), dan Metadata (read).
- Repository harus mengaktifkan GitHub Actions.

## Instalasi

1. Upload dan extract ZIP ini ke server Pterodactyl.
2. Buat repository GitHub baru, misalnya `flutter-builder`.
3. Upload seluruh isi folder ini ke root repository. Pastikan `.github/workflows/flutter-build.yml` ikut ter-upload.
4. Pada `setting.js`, isi:
   - `BOT_TOKEN`
   - `REQUIRED_CHANNEL`, `CHANNEL_ID`, `CHANNEL_URL`
   - `BOT_LOGO_URL`
   - `GITHUB.TOKEN`, `GITHUB.OWNER`, `GITHUB.REPO`, `GITHUB.BRANCH`
5. Pada `telegram.js`, ganti `123456789` dengan Telegram user ID owner.
6. Pastikan bot menjadi admin channel agar dapat memeriksa keanggotaan dan mengirim notifikasi.
7. Pada Pterodactyl Startup, gunakan `npm install && npm start`. Jika egg meminta startup command terpisah, isi `npm start`.
8. Jalankan server.

## GitHub token

Gunakan token khusus untuk repository builder. Jangan membagikan token atau mengunggahnya ke repository publik. Untuk fine-grained token, berikan akses repository yang diperlukan:
- Contents: Read and write
- Actions: Read and write
- Metadata: Read

Jika workflow tidak dapat dipicu, periksa izin token dan Actions pada repository.

## Alur

`/start` -> cek join channel -> verifikasi -> menu -> Flutter/Web -> kirim ZIP -> GitHub Actions -> APK/artifact dikirim balik.

## Batas penting (baca sebelum produksi)

- Build tidak dijalankan pada panel; panel hanya menjalankan bot dan mengatur antrean.
- GitHub Actions hosted runner mempunyai batas waktu dan kapasitas penyimpanan sendiri.
- Bot API Telegram cloud umumnya hanya mengizinkan bot mengunduh file hingga 20 MB. Karena itu `MAX_UPLOAD_MB` default 20 MB. Mengubah angka konfigurasi tidak otomatis menghilangkan batas API Telegram.
- GitHub Git Data API memiliki batas ukuran blob dan rate limit. Implementasi starter ini membatasi tiap file input sekitar 900 KB dan jumlah file 250. Untuk project besar, integrasikan object storage (S3/R2) atau Git LFS + workflow download; ZIP 2 GB tidak dijamin dan tidak didukung oleh konfigurasi default ini.
- Batas kirim file Telegram bergantung pada Bot API yang digunakan dan batas platform.
- Workflow mendukung Flutter APK Release, Flutter APK Debug, dan Flutter Web. Pilihan Debug tersedia di submenu Flutter Build.
- Web build non-Flutter saat ini mengemas source sebagai artifact; bukan hosting/deployment website.
- Data JSON lokal cocok untuk satu proses bot saja. Jangan jalankan dua instance bersamaan. Untuk skala besar, gunakan database transaksional.
- Status maintenance disimpan di memori proses; restart bot mematikannya. Simpan maintenance ke database jika ingin persisten.
- Pembuatan commit input per build menulis file input ke branch builder. Atur repository privat dan bersihkan `.build-inputs` secara berkala.

## Perintah

- `/start`, `/menu`
- `/addcredit USER_ID JUMLAH` — reseller/owner
- `/address USER_ID` — owner
- `/addowner USER_ID` — owner

## Catatan keamanan dan operasional

- Jangan gunakan bot token atau GitHub token contoh.
- Batasi akses repository ke owner.
- Bot harus menerima ZIP project yang memang diizinkan untuk dibangun.
- Periksa log GitHub Actions untuk error dependency, Gradle, Android SDK, signing, dan konfigurasi project.
- Jangan mengandalkan tombol cancel untuk menghentikan job yang sudah selesai; pembatalan dikirim ke GitHub API.
