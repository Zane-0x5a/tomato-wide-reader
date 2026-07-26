import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/settings';

describe('settings migration boundary', () => {
  it('uses readable line-height defaults', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.fontSize).toBe(18);
    expect(DEFAULT_SETTINGS.lineHeight).toBe(1.9);
  });

  it('clamps corrupted or extreme stored values', () => {
    const settings = sanitizeSettings({ fontSize: 200, lineHeight: -4, columnGap: Number.NaN, theme: 'neon' });
    expect(settings.fontSize).toBe(24);
    expect(settings.lineHeight).toBe(1.4);
    expect(settings.columnGap).toBe(DEFAULT_SETTINGS.columnGap);
    expect(settings.theme).toBe('system');
  });

  it('allows line-height above 2', () => {
    expect(sanitizeSettings({ lineHeight: 2.4 }).lineHeight).toBe(2.4);
    expect(sanitizeSettings({ lineHeight: 3 }).lineHeight).toBe(2.6);
  });
});
