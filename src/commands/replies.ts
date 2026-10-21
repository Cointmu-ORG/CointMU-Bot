export const REPLY_CHANNEL_REJECTED =
  '⛔ Command tidak bisa dipakai di channel. Untuk mengumumkan block ke channel, isi CHAT_ID di env bot.';
export const REPLY_ANONYMOUS_REJECTED =
  '⛔ Pengirim tidak dikenali (admin anonim atau atas nama channel). Matikan mode anonim, lalu kirim ulang command-nya.';
export const REPLY_ADMIN_ONLY = '⛔ Perintah ini khusus admin bot.';
export const REPLY_STATS_DENIED =
  '⛔ /status, /last, dan /top hanya bisa dipakai di chat pengumuman, atau oleh admin bot.';

/** answerCallbackQuery toasts: only the person who pressed sees them (max 200 chars). */
export const Toast = {
  EXPIRED: '⌛ Menu kedaluwarsa. Ketik /menu untuk membuka menu baru.',
  ADMIN_ONLY: '⛔ Khusus admin bot.',
  STATS_DENIED: '⛔ Hanya bisa dipakai di grup pengumuman, atau oleh admin bot.',
  COOLDOWN: '⏳ Tunggu beberapa detik sebelum menekan lagi.',
  BUSY: '⏳ Lagi ramai, coba lagi sebentar.',
  DUPLICATE: 'ℹ️ Baru saja ditampilkan di atas.',
  NOT_YOURS: '⛔ Hanya yang memulai aksi ini yang bisa menekan tombol ini.',
  PRIVATE_ONLY: 'ℹ️ Buka chat pribadi dengan bot untuk menambah admin.',
} as const;
