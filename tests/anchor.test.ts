import { describe, expect, it } from 'vitest';
import { closestAnchorBlock, parseAnchor, serializeAnchor } from '../src/anchor';

describe('semantic anchors', () => {
  it('round-trips block ids that contain punctuation', () => {
    const anchor = { blockId: 'b-12-a:b/中', characterOffset: 19, affinity: 'forward' as const };
    expect(parseAnchor(serializeAnchor(anchor))).toEqual(anchor);
  });

  it('chooses the closest surviving block after chapter edits', () => {
    expect(closestAnchorBlock(
      { blockId: 'b-9-old', characterOffset: 0, affinity: 'forward' },
      ['b-2-a', 'b-8-b', 'b-14-c'],
    )).toBe('b-8-b');
  });

  it('rejects malformed storage values', () => {
    expect(parseAnchor('not-an-anchor')).toBeNull();
  });
});
