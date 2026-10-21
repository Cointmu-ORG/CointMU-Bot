const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};
const HASHRATE_UNITS = ['H/s', 'kH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s'] as const;
const UNIT_STEP = 1000;
const DECIMALS = 2;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86_400;
const DURATION_UNITS: readonly (readonly [number, string])[] = [
  [SECONDS_PER_DAY, 'hari'],
  [SECONDS_PER_HOUR, 'jam'],
  [SECONDS_PER_MINUTE, 'menit'],
];

/** Escapes text for Telegram's HTML parse mode. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** Escaped value wrapped in <code>. */
export function code(value: string | number): string {
  return `<code>${escapeHtml(String(value))}</code>`;
}

/** Integer with Indonesian thousand separators: 1169998 -> "1.169.998". */
export function formatThousands(value: bigint | number): string {
  return BigInt(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Decimal number with a comma as decimal separator: 81.234 -> "81,23". */
export function formatDecimal(value: number, decimals = DECIMALS): string {
  const [whole = '0', fraction] = value.toFixed(decimals).split('.');
  const grouped = formatThousands(BigInt(whole));
  return fraction ? `${grouped},${fraction}` : grouped;
}

/** Picks the largest unit that keeps the value >= 1: 81234 -> "81,23 kH/s". */
export function formatHashrate(hashesPerSecond: number): string {
  let value = hashesPerSecond;
  let unitIndex = 0;
  while (value >= UNIT_STEP && unitIndex < HASHRATE_UNITS.length - 1) {
    value /= UNIT_STEP;
    unitIndex += 1;
  }
  const decimals = unitIndex === 0 ? 0 : DECIMALS;
  return `${formatDecimal(value, decimals)} ${HASHRATE_UNITS[unitIndex]}`;
}

/** Human duration in Indonesian, two most significant parts: "1 jam 5 menit", "42 detik". */
export function formatDuration(ms: number): string {
  let seconds = Math.max(0, Math.round(ms / MS_PER_SECOND));
  const parts: string[] = [];
  for (const [size, label] of DURATION_UNITS) {
    const amount = Math.floor(seconds / size);
    if (amount > 0) parts.push(`${amount} ${label}`);
    seconds -= amount * size;
  }
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} detik`);
  return parts.slice(0, 2).join(' ');
}
