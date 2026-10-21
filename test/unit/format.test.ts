import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  formatDuration,
  formatHashrate,
  formatThousands,
} from '../../src/render/format.js';

describe('formatThousands', () => {
  it('uses dots as thousand separators', () => {
    expect(formatThousands(1_169_998n)).toBe('1.169.998');
    expect(formatThousands(999)).toBe('999');
    expect(formatThousands(1000)).toBe('1.000');
  });
});

describe('formatHashrate', () => {
  it('picks the unit automatically', () => {
    expect(formatHashrate(999)).toBe('999 H/s');
    expect(formatHashrate(81_234)).toBe('81,23 kH/s');
    expect(formatHashrate(1_500_000)).toBe('1,50 MH/s');
  });

  it('handles zero', () => {
    expect(formatHashrate(0)).toBe('0 H/s');
  });
});

describe('escapeHtml', () => {
  it('escapes the characters Telegram HTML cares about', () => {
    expect(escapeHtml('<b>"a" & b</b>')).toBe('&lt;b&gt;&quot;a&quot; &amp; b&lt;/b&gt;');
  });
});

describe('formatDuration', () => {
  it('shows the two most significant units in Indonesian', () => {
    expect(formatDuration(42_000)).toBe('42 detik');
    expect(formatDuration(3_725_000)).toBe('1 jam 2 menit');
    expect(formatDuration(0)).toBe('0 detik');
  });
});
