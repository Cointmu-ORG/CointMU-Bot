# CointMU Mining Feed — Bot Telegram

Bot Telegram untuk chain CointMU (PoW, chain ID 1912, Geth 1.10.26):

1. **Mengumumkan block baru**: siapa (alamat wallet) yang mendapat block berapa, beserta hash, nonce, mixHash, difficulty dan estimasi hashrate jaringan. Statusnya diperbarui saat block final atau kalah reorg.
2. **Memberi alert kesehatan node** ke chat terpisah: RPC mati, head tidak naik, peer kurang, atau node sedang syncing. Bot juga mengirim kabar saat node pulih, lengkap dengan durasi gangguan.

Bot **hanya** memanggil method RPC baca: `eth_blockNumber`, `eth_getBlockByNumber`, `net_peerCount`, `eth_syncing`, `eth_chainId`. Method lain ditolak di kode sebelum dikirim (lihat `src/rpc/client.ts`).

## Contoh pesan

```
🪙 Mining Reward 🪙
⛏️ Block: #234075
👛 Wallet: 0x3c9b08645c616ae3966252f276aa23825b3dcd85
🔗 Hash: 0x7ce6f6dc…74f9
⬅️ Prev block: 0xde250982…a0c6
🎲 Nonce: 0x63bcedf92f5600f3
🧬 MixHash: 0x78378235…7899
💪 Difficulty: 1.288.031
⚡ Hashrate: ≈ 90,14 kH/s (rata-rata 20 block)
⏳ Status: 1/6 konfirmasi
🚀 Block time: 1 detik
```

(Di Telegram semua hash ditampilkan penuh dalam `<code>`.)

- Beberapa block dalam satu interval kirim digabung jadi satu pesan, satu kartu per block, diurutkan naik. Pesan dipecah di batas kartu kalau melebihi 4096 karakter.
- Setiap pesan diedit **sekali** saat block terbarunya mencapai `CONFIRMATIONS` (semua kartu jadi `✅ Status: Final`). Kalau ada block yang kalah reorg, pesan langsung diedit menjadi `❌ Status: Reorg (block kalah)`. Hitungan konfirmasi di antaranya tidak diedit, supaya hemat rate limit.
- Bonus: 🎉 `Block pertama!` untuk wallet yang baru pertama kali muncul, 🔥 streak di kelipatan 10 (x10, x20, …) untuk wallet yang sama berturut-turut, 🚀 kalau block time < 3 detik, 🐢 kalau > 60 detik.
- Hashrate = jumlah difficulty `HASHRATE_WINDOW` block terakhir ÷ selisih timestamp block terbaru dan block ke-N sebelumnya. Ini hashrate **jaringan total**, bukan per miner.

## 1. Membuat bot di BotFather

1. Buka Telegram, chat **@BotFather**, kirim `/newbot`.
2. Isi nama tampilan (mis. `CointMU Mining Feed`) dan username yang berakhiran `bot` (mis. `cointmu_feed_bot`).
3. BotFather memberi **token** (bentuknya `123456789:AA…`). Simpan token **hanya** di file `.env` (`BOT_TOKEN=`). Jangan menempelkannya ke chat, issue, atau commit.
4. Tidak perlu `/setcommands` di BotFather. Bot mendaftarkan sendiri daftar command untuk menu "/" (`setMyCommands`), lihat bagian 5.
5. Kalau token bocor: `/revoke` di BotFather, lalu ganti `BOT_TOKEN`.

## 2. Setup dari Telegram (hanya butuh `RPC_URL` dan `BOT_TOKEN`)

Bot bisa jalan hanya dengan `RPC_URL` dan `BOT_TOKEN` di `.env`. Tujuan pengumuman, tujuan alert, dan admin diatur dari dalam chat, lalu disimpan di SQLite.

1. **Jalankan bot**, lalu cari **kode klaim admin** di log. Kode ini hanya dicetak selama bot belum punya admin:
   ```bash
   docker compose logs bot | grep claimCode
   ```
   Setiap kali bot start tanpa admin, kode lama hangus dan kode baru dicetak.
2. **Buka chat pribadi dengan bot**, kirim `/start`, lalu `/claim <kode>`. Kamu menjadi admin pertama dan kodenya langsung hangus.
   - `/claim` **hanya** di chat pribadi. Kalau dikirim di grup, kode itu dianggap bocor: langsung hangus, kode baru dicetak di log, dan bot membalas bahwa `/claim` hanya untuk chat pribadi.
   - Kode disimpan sebagai hash SHA-256 dan dibandingkan secara constant-time.
3. **Tambahkan bot ke grup pengumuman**, lalu kirim `/setchat` di grup itu. Block yang sudah tersimpan sebelumnya ditandai terlewat, jadi hanya block baru yang diumumkan.
4. **Opsional: grup alert terpisah.** Tambahkan bot ke grup itu, lalu kirim `/setalert` di sana. Kalau belum diset, alert dikirim ke **chat pribadi setiap admin**, jadi pastikan tiap admin pernah mengirim `/start` ke bot.
5. Cek hasilnya dengan `/chats`.

Catatan:

- Selama tujuan pengumuman belum diset, bot tetap mengumpulkan block, tetapi tidak mengirim apa pun.
- **Admin anonim** di grup tidak dikenali sebagai user. Matikan mode anonim sebelum memakai command.
- **Channel** tidak bisa diatur lewat chat. Kalau ingin mengumumkan ke channel, isi `CHAT_ID` di env, lalu jadikan bot admin channel dengan izin _Post messages_ dan _Edit messages of others_.
- `/id` bisa dipakai siapa pun untuk melihat user ID dan chat ID-nya sendiri. User ID ini dipakai untuk `/addadmin` atau `ALLOWED_USER_IDS`.
- Nilai di env selalu **menang**. Kalau `CHAT_ID`, `ALERT_CHAT_ID`, atau `ALLOWED_USER_IDS` diisi, nilai itu tidak bisa diubah dari chat. Mengisi `ALLOWED_USER_IDS` juga mematikan kode klaim.

## 3. Konfigurasi

Salin `.env.example` menjadi `.env`, lalu isi. Semua variabel:

| Variabel                     | Default         | Keterangan                                                                                                        |
| ---------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `RPC_URL`                    | —               | **Wajib**. RPC HTTP node CointMU, mis. `http://<GETH_HOST>:<PORT>`                                                |
| `RPC_TIMEOUT_MS`             | `5000`          | Timeout tiap panggilan RPC                                                                                        |
| `EXPECTED_CHAIN_ID`          | `1912`          | Bot berhenti saat start kalau chain ID tidak cocok                                                                |
| `BOT_TOKEN`                  | —               | **Wajib** (kecuali `DRY_RUN=true`)                                                                                |
| `CHAT_ID`                    | kosong          | Opsional. Chat/channel pengumuman; kalau diisi, `/setchat` dikunci                                                |
| `ALERT_CHAT_ID`              | kosong          | Opsional. Chat alert; kalau diisi, `/setalert` dikunci                                                            |
| `ALLOWED_USER_IDS`           | kosong          | Opsional. Admin dari env (dipisah koma); mematikan kode klaim dan tidak bisa dihapus lewat chat                   |
| `ALLOWED_CHAT_IDS`           | kosong          | Opsional. Selain chat pengumuman, semua anggota chat ini boleh memakai `/status` `/last` `/top`                   |
| `COMMAND_COOLDOWN_SECONDS`   | `5`             | Jeda minimal antar command/tombol per user (admin tidak terkena)                                                  |
| `COMMAND_QUEUE_MAX`          | `20`            | Maksimal balasan command yang menunggu di antrean; lebih dari itu ditolak ("lagi ramai")                          |
| `COMMAND_REPLIES_PER_MINUTE` | `8`             | Maksimal balasan command per menit per grup                                                                       |
| `DUPLICATE_WINDOW_SECONDS`   | `10`            | Tampilan yang sama (status/last/top) tidak dikirim ulang ke chat yang sama dalam jendela ini                      |
| `POLL_INTERVAL_MS`           | `1000`          | Interval cek `eth_blockNumber`                                                                                    |
| `SEND_INTERVAL_MS`           | `10000`         | Interval kirim digest                                                                                             |
| `MIN_SEND_GAP_MS`            | `3000`          | Jeda minimal antar pesan/edit ke Telegram                                                                         |
| `CONFIRMATIONS`              | `6`             | Konfirmasi untuk dianggap final (head − number + 1)                                                               |
| `HASHRATE_WINDOW`            | `20`            | Jumlah block untuk rata-rata hashrate                                                                             |
| `START_BACKFILL`             | `50`            | Saat DB kosong: N block terakhir disimpan diam-diam (statistik saja)                                              |
| `MIN_PEERS`                  | `1`             | Alert kalau `net_peerCount` di bawah ini                                                                          |
| `STALL_MINUTES`              | `5`             | Alert kalau head tidak naik selama ini; `0` = matikan (untuk maintenance)                                         |
| `RPC_FAIL_THRESHOLD`         | `10`            | Alert setelah N poll gagal berturut-turut                                                                         |
| `ALERT_COOLDOWN_MINUTES`     | `10`            | Insiden sejenis yang kambuh dalam masa ini tidak di-alert ulang, kecuali masih berlangsung setelah cooldown habis |
| `HEARTBEAT_URL`              | kosong          | Di-ping tiap 60 detik selama collector sehat (mis. healthchecks.io)                                               |
| `DB_PATH`                    | `./data/bot.db` | File SQLite (`./data/dry-run.db` saat dry-run)                                                                    |
| `DATA_RETENTION_DAYS`        | `30`            | Data yang lebih tua dari ini dihapus tiap jam                                                                     |
| `DRY_RUN`                    | `false`         | `true` = cetak ke konsol, tidak kirim ke Telegram                                                                 |
| `LOG_LEVEL`                  | `info`          | `debug`/`info`/`warn`/`error`                                                                                     |

## 4. Menjalankan

### Dengan Docker (disarankan)

```bash
cp .env.example .env   # cukup isi RPC_URL dan BOT_TOKEN
docker compose up -d --build
docker compose logs -f bot
```

- Container jalan sebagai user non-root, root filesystem read-only, `cap_drop: ALL`, dan **tidak mempublish port apa pun**. Bot hanya membuat koneksi keluar.
- Data SQLite ada di volume `bot-data` (`/data/bot.db`).
- Di dalam container, `127.0.0.1` adalah container itu sendiri. Pakai alamat node yang bisa dijangkau dari container (`http://<GETH_HOST>:<PORT>`), jangan `127.0.0.1`.
- Berhenti: `docker compose down` (data tetap tersimpan). **Jangan** pakai `-v` kecuali memang ingin menghapus DB.

### Tanpa Docker

Butuh Node 22.

```bash
npm ci
npm run build
npm start          # membaca .env otomatis (node --env-file-if-exists)
```

### Mode dry-run

Pesan dicetak ke konsol. Tidak ada yang dikirim ke Telegram, command tidak aktif, dan tidak ada kode klaim. Tujuan pengumuman dan alert otomatis diisi `dry-run`.

```bash
DRY_RUN=true RPC_URL=http://127.0.0.1:8545 npm run dry-run
```

**Penting:** dry-run memakai DB terpisah (default `./data/dry-run.db`). Message ID di dry-run palsu, tetapi block-nya tetap tercatat sebagai "terkirim". Jadi **jangan** arahkan dry-run ke DB produksi, atau block itu tidak akan pernah diumumkan ke Telegram.

## 5. Menu tombol dan command

### Menu tombol (tanpa mengetik)

`/start`, `/help` dan `/menu` menampilkan teks bantuan dan menu tombol yang disesuaikan dengan peran:

| Siapa / di mana                                      | Yang tampil                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| Admin (di mana saja)                                 | 📊 Status · 🧱 Block terakhir · 🏆 Top · ❓ Bantuan · ⚙️ Pengaturan |
| Anggota di chat pengumuman (atau `ALLOWED_CHAT_IDS`) | 📊 Status · 🧱 Block terakhir · 🏆 Top · ❓ Bantuan                 |
| Anggota di chat pribadi atau grup lain               | Teks bantuan dasar dan `/id`, tanpa tombol                          |
| Chat pribadi, bot belum punya admin                  | Ditambah petunjuk cara klaim (kodenya tidak pernah ditampilkan)     |

Isi **⚙️ Pengaturan** (khusus admin):

- 📍 Jadikan chat ini tujuan pengumuman
- 🚨 Jadikan chat ini tujuan alert
- 🧹 Lepas pengumuman
- 🧹 Lepas alert
- 📋 Tujuan aktif
- 👥 Kelola admin: daftar admin dengan tombol ❌ per admin (admin 🔒 dari env tanpa tombol hapus), plus ➕ Tambah admin.

Perilaku:

- **Chat pribadi:** navigasi mengedit pesan yang sama, dan ada tombol ⬅️ Kembali. Kalau pesan lama sudah tidak bisa diedit, bot mengirim pesan baru.
- **Grup:** hasil tombol dikirim sebagai **pesan baru**. Menu di grup dipakai bersama, jadi tidak diedit.
- **Penolakan lewat tombol** muncul sebagai _toast_ (notifikasi kecil yang hanya terlihat oleh yang menekan), bukan pesan di grup. Contohnya: bukan admin, cooldown, menu kedaluwarsa, "lagi ramai", atau "baru saja ditampilkan di atas".
- **Aksi merusak** (lepas pengumuman, lepas alert, hapus admin) meminta konfirmasi ✅ Yakin / ↩️ Batal:
  - Konfirmasi disimpan di server dan berlaku 5 menit. Tombolnya hanya membawa id acak.
  - Hanya admin yang memulai aksi yang bisa menekan Yakin/Batal; yang lain mendapat toast penolakan.
  - Izin admin dicek ulang saat Yakin ditekan.
  - Pesan konfirmasi diedit menjadi hasilnya (✅ selesai / ↩️ dibatalkan).
  - Konfirmasi yang kedaluwarsa atau sudah dipakai dijawab toast "kedaluwarsa".
- **➕ Tambah admin** hanya bisa di chat pribadi. Bot memunculkan tombol **👤 Pilih pengguna** (fitur Telegram `KeyboardButtonRequestUsers`); kamu memilih orangnya dari daftar kontak/chat Telegram.
  - Permintaan ini berlaku 5 menit dan hanya untuk admin yang memintanya.
  - Kalau aplikasi Telegram terlalu lama untuk fitur ini, pakai cadangan `/addadmin <user_id>`. User ID bisa dilihat dengan `/id`.
- **Keamanan:** isi tombol tidak pernah dipercaya. Setiap tekanan dicek ulang di server (izin, cooldown, kapasitas antrean). Tombol dari versi menu lama atau yang tidak dikenal dijawab "menu kedaluwarsa".

### Menu "/" (setMyCommands)

Bot mendaftarkan daftar command sendiri saat start dan setiap kali daftar admin berubah:

- **Chat pribadi (umum):** `/start` `/help` `/menu` `/id`
- **Semua grup:** ditambah `/status` `/last` `/top`
- **Chat pribadi setiap admin:** daftar lengkap, termasuk command admin. Di grup, admin pun melihat daftar umum.

### Daftar command

| Command                    | Siapa                             | Keterangan                                                                                         |
| -------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------- |
| `/start`, `/help`, `/menu` | siapa pun                         | Teks bantuan sesuai peran dan menu tombol                                                          |
| `/id`                      | siapa pun                         | Membalas user ID dan chat ID pengirim saja                                                         |
| `/claim <kode>`            | siapa pun, **hanya chat pribadi** | Bootstrap admin pertama (lihat bagian 2)                                                           |
| `/status`                  | lihat di bawah                    | Head, umur block terakhir, peer, rata-rata block time 20 block, hashrate, syncing, insiden terbuka |
| `/last [n]`                | lihat di bawah                    | n block terakhir (default 10, maksimal 30)                                                         |
| `/top`                     | lihat di bawah                    | Peringkat wallet 24 jam terakhir dan sejak bot start                                               |
| `/setchat`                 | admin, di grup atau chat pribadi  | Jadikan chat ini tujuan pengumuman                                                                 |
| `/unsetchat`               | admin                             | Hentikan pengumuman (block tetap disimpan)                                                         |
| `/setalert`                | admin                             | Jadikan chat ini tujuan alert                                                                      |
| `/unsetalert`              | admin                             | Kembalikan alert ke chat pribadi admin                                                             |
| `/chats`                   | admin                             | Tampilkan tujuan aktif (dan sumbernya: env/chat), daftar admin, status klaim                       |
| `/addadmin <user_id>`      | admin                             | Tambah admin (user ID dari `/id`)                                                                  |
| `/removeadmin <user_id>`   | admin                             | Hapus admin. Admin dari env hanya bisa dihapus lewat env, dan admin terakhir tidak bisa dihapus    |

Aturan akses:

- **`/status`, `/last` dan `/top`** boleh dipakai siapa pun di chat pengumuman (dan chat di `ALLOWED_CHAT_IDS`). Di chat pribadi atau grup lain, hanya admin yang boleh.
- **Cooldown:** non-admin terkena jeda `COMMAND_COOLDOWN_SECONDS` (default 5 detik) per user, untuk command yang diketik maupun tombol. Command ketik di dalam jeda diabaikan tanpa balasan; tombol dijawab dengan toast.
- **Command admin yang diketik non-admin:** di grup **diabaikan tanpa balasan**, di chat pribadi dibalas "⛔ khusus admin bot".
- Command dari channel atau dari admin anonim ditolak dengan pesan yang menjelaskan alasannya.

### Antrean dan batas pengiriman

Semua pesan lewat satu antrean dengan prioritas **alert kesehatan > digest block / edit status > balasan command**, jadi balasan command tidak pernah menunda alert maupun digest.

- **Jeda per chat:** `MIN_SEND_GAP_MS`. Chat lain tidak ikut menunggu. Kalau Telegram membalas 429, seluruh antrean berhenti sesuai `retry_after`.
- **Antrean balasan dibatasi** (`COMMAND_QUEUE_MAX`, default 20). Kalau penuh, tombol dijawab toast "lagi ramai, coba lagi sebentar" dan tidak ada yang ditambahkan ke antrean.
- **Per grup:** maksimal `COMMAND_REPLIES_PER_MINUTE` balasan per menit (default 8), supaya anggaran Telegram sekitar 20 pesan per menit per grup masih menyisakan ruang untuk digest dan edit status.
- **Anti-duplikat:** tampilan yang sama (status/last/top) di chat yang sama dalam `DUPLICATE_WINDOW_SECONDS` (default 10) tidak dikirim ulang. Tombol dijawab toast "baru saja ditampilkan di atas".
- `answerCallbackQuery` (jawaban tombol) dikirim **langsung**, di luar antrean.

## Uji manual di grup kecil

Siapkan grup kecil berisi **kamu (admin)**, **satu akun kedua (non-admin)** dan **bot**. Jalankan bot dengan token asli, lalu centang:

- [ ] **/start dan /help per peran**
  - Admin di chat pribadi: menu lengkap dengan ⚙️ Pengaturan.
  - Akun kedua di chat pribadi: hanya teks bantuan, tanpa tombol.
  - Di grup (setelah `/setchat`), akun kedua melihat 📊🧱🏆❓ tanpa ⚙️.
  - Sebelum ada admin: `/help` di chat pribadi menjelaskan cara klaim, tanpa menampilkan kode.
- [ ] **Klik semua tombol**
  - Status, Block terakhir, Top, Bantuan, lalu semua tombol di Pengaturan.
  - Di chat pribadi, pesan yang sama berubah dan ada ⬅️ Kembali.
  - Di grup, hasilnya muncul sebagai pesan baru.
- [ ] **Tombol admin dari akun kedua**
  - Akun kedua menekan ⚙️ Pengaturan, atau tombol pengaturan di pesan yang dibuat admin: muncul toast "Khusus admin bot", dan **tidak ada pesan baru di grup**.
  - Akun kedua mengetik `/setchat` di grup: tidak ada balasan sama sekali.
  - Akun kedua mengetik `/setchat` di chat pribadi: dibalas "⛔".
- [ ] **Tombol beruntun**
  - Akun kedua menekan beberapa tombol dalam 5 detik: toast cooldown.
  - Dua akun menekan 📊 Status bergantian dalam 10 detik: yang kedua mendapat toast "baru saja ditampilkan di atas".
  - Menekan cepat dan bergantian sampai lebih dari 8 balasan per menit: toast "lagi ramai".
- [ ] **Yakin/Batal**
  - Admin menekan 🧹 Lepas pengumuman di grup.
  - Akun kedua menekan ✅ Yakin: toast penolakan, pengaturan tidak berubah.
  - Admin menekan ↩️ Batal: pesan berubah menjadi "Dibatalkan".
  - Ulangi, lalu tunggu lebih dari 5 menit sebelum menekan Yakin: toast "kedaluwarsa".
- [ ] **Menu lama kedaluwarsa**
  - Tekan tombol dari pesan menu yang sangat lama, atau Yakin yang sudah dipakai: toast "Menu kedaluwarsa".
- [ ] **Tambah admin**
  - Admin: ⚙️ → 👥 Kelola admin → ➕ Tambah admin (di chat pribadi) → 👤 Pilih pengguna → pilih akun kedua.
  - Akun kedua sekarang melihat ⚙️ Pengaturan, dan menu "/" di chat pribadinya berisi command admin.
  - Hapus lagi lewat ❌, lalu ✅ Yakin.
  - Coba hapus admin terakhir: ditolak.
- [ ] **Alert**
  - Jalankan bot dengan `RPC_URL` yang sengaja salah (mis. port yang tidak ada). Setelah `RPC_FAIL_THRESHOLD` poll gagal, alert "RPC node tidak merespons" masuk ke tujuan alert, atau ke chat pribadi admin kalau belum diset.
  - Kembalikan `RPC_URL` yang benar lalu restart: pesan "Pulih" dikirim, lengkap dengan durasi gangguan. Insiden dan alertnya tersimpan di DB, jadi tetap terkirim meski bot di-restart.

## 6. Ketahanan

- Semua state ada di SQLite (WAL). Setelah restart, bot melanjutkan dari block terakhir di DB. Block yang terlewat selama bot mati diumumkan (dipecah per 4096 karakter).
- Block baru ditandai `sent=1` **hanya setelah** Telegram menjawab sukses, jadi tidak ada block yang hilang. Satu-satunya celah duplikasi: proses mati tepat di antara balasan Telegram dan penulisan DB (milidetik).
- HTTP 429 ditangani dengan menunggu `retry_after`. Error "message is not modified" diabaikan.
- Reorg: kalau `parentHash` block baru tidak cocok dengan hash di DB, bot mencari titik temu (sampai 64 block), menandai block yang kalah sebagai `orphaned`, lalu mengambil ulang rantai baru. Reorg yang lebih dalam diterima apa adanya dan dikirim sebagai alert.
- Shutdown graceful (SIGINT/SIGTERM): loop dihentikan, pekerjaan yang sedang jalan diselesaikan, lalu DB ditutup. Ada batas paksa 30 detik.
- Retensi: block yang belum terkirim tetap disimpan sampai diumumkan. Pengecualiannya selama tujuan pengumuman belum diset: block lama dihapus mengikuti usia normal `DATA_RETENTION_DAYS`, tidak lebih cepat. Tabel admin dan pengaturan tidak pernah dihapus.
- Hasil polling disimpan per menit (`rpc_samples`: jumlah sukses/gagal, head, peer, syncing, error terakhir).

## 7. Catatan hosting

- **Taruh bot di mesin terpisah dari node.** Kalau mesin node mati, alert tetap terkirim, dan `HEARTBEAT_URL` memberi tahu kalau bot sendiri yang mati.
- Firewall node: izinkan **hanya IP mesin bot** ke port RPC 8545. Jangan buka 8545 ke publik.
- Jangan aktifkan modul `personal`, `miner` atau `admin` di HTTP RPC (`--http.api`). Bot tidak membutuhkannya.
- Untuk maintenance terencana, set `STALL_MINUTES=0` lalu restart bot agar tidak ada alert "head tidak naik".

## 8. Pengembangan

```bash
npm run lint        # eslint + prettier --check
npm run typecheck
npm test            # vitest: unit + integrasi (mock RPC & mock Telegram di 127.0.0.1, port acak)
npm run build
```

Struktur singkat:

```
src/
  main.ts, app.ts        start, loop, shutdown
  core.ts, wiring.ts     infrastruktur dan perakitan komponen
  config.ts              validasi env (zod)
  rpc/                   whitelist method baca + validasi block
  collector/             polling head, backfill, deteksi reorg, probe peer/syncing
  sender/                digest + edit status
  telegram/              client HTTP, antrean rate-limit, dry-run
  render/                format kartu, escape HTML, pemecahan pesan
  health/                kondisi, insiden + alert, heartbeat
  commands/              router command & tombol (akses, cooldown, antrean), menu, konfirmasi, pilih admin
  settings/              tujuan & admin (env + SQLite), kode klaim admin
  db/                    SQLite (migrasi, repository)
  maintenance/           retensi data
```
