import type { ReaderSettings, SemanticAnchor } from './model';

export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: 'system',
  fontFamily: 'sans',
  fontSize: 18,
  lineHeight: 1.9,
  paragraphGap: 0.32,
  columnGap: 64,
  pageMargin: 72,
  showPageIndicator: true,
};

const SETTINGS_KEY = 'tomato-wide-reader:settings:v1';

export async function loadSettings(): Promise<ReaderSettings> {
  const result = await browser.storage.local.get(SETTINGS_KEY);
  return sanitizeSettings(result[SETTINGS_KEY]);
}

export async function saveSettings(settings: ReaderSettings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: sanitizeSettings(settings) });
}

export function sanitizeSettings(value: unknown): ReaderSettings {
  const input = typeof value === 'object' && value ? (value as Partial<ReaderSettings>) : {};
  // Migrate the previous dense default (1.58) to the new baseline (1.9).
  const rawLineHeight = input.lineHeight === 1.58 ? DEFAULT_SETTINGS.lineHeight : input.lineHeight;
  return {
    theme: ['system', 'light', 'dark'].includes(input.theme ?? '') ? input.theme! : DEFAULT_SETTINGS.theme,
    fontFamily: ['sans', 'serif'].includes(input.fontFamily ?? '') ? input.fontFamily! : DEFAULT_SETTINGS.fontFamily,
    fontSize: clamp(input.fontSize, 16, 24, DEFAULT_SETTINGS.fontSize),
    lineHeight: clamp(rawLineHeight, 1.4, 2.6, DEFAULT_SETTINGS.lineHeight),
    paragraphGap: clamp(input.paragraphGap, 0, 1, DEFAULT_SETTINGS.paragraphGap),
    columnGap: clamp(input.columnGap, 32, 112, DEFAULT_SETTINGS.columnGap),
    pageMargin: clamp(input.pageMargin, 32, 120, DEFAULT_SETTINGS.pageMargin),
    showPageIndicator: input.showPageIndicator ?? DEFAULT_SETTINGS.showPageIndicator,
  };
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

export function anchorKey(itemId: string): string {
  return `tomato-wide-reader:anchor:v1:${itemId}`;
}

export async function loadAnchor(itemId: string): Promise<SemanticAnchor | null> {
  const key = anchorKey(itemId);
  const result = await browser.storage.local.get(key);
  const value = result[key];
  if (!value || typeof value !== 'object') return null;
  const candidate = value as SemanticAnchor;
  return typeof candidate.blockId === 'string' && Number.isInteger(candidate.characterOffset)
    ? candidate
    : null;
}

export async function saveAnchor(itemId: string, anchor: SemanticAnchor): Promise<void> {
  await browser.storage.local.set({ [anchorKey(itemId)]: anchor });
}
