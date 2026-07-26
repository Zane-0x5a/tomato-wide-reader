import { describe, expect, it } from 'vitest';
import { containsPrivateUse, normalizeFanqieText, stableBlockId } from '../src/content/normalize';

describe('Fanqie Unicode normalization', () => {
  it('decodes known private-use glyphs into canonical Unicode', () => {
    const result = normalizeFanqieText('\uE3E9\uE3EA\uE3EC');
    expect(result.text).toBe('在主家');
    expect(result.decoded).toBe(3);
    expect(result.unknownPua).toEqual([]);
    expect(containsPrivateUse(result.text)).toBe(false);
  });

  it('reports unknown private-use glyphs instead of silently deleting them', () => {
    const result = normalizeFanqieText('\uE000');
    expect(result.text).toBe('\uE000');
    expect(result.unknownPua).toEqual(['E000']);
  });

  it('creates deterministic but order-sensitive block identifiers', () => {
    expect(stableBlockId(2, '同一段')).toBe(stableBlockId(2, '同一段'));
    expect(stableBlockId(2, '同一段')).not.toBe(stableBlockId(3, '同一段'));
  });
});
