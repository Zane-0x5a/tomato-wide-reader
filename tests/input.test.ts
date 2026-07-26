import { describe, expect, it } from 'vitest';
import { directionForKey, isEditableEventPath } from '../src/input';

describe('reader input ownership', () => {
  it.each([
    ['ArrowRight', 'next'],
    ['PageDown', 'next'],
    [' ', 'next'],
    ['ArrowLeft', 'previous'],
    ['PageUp', 'previous'],
  ] as const)('maps %s to %s', (key, direction) => {
    expect(directionForKey(key)).toBe(direction);
  });

  it('ignores unrelated keys', () => {
    expect(directionForKey('ArrowDown')).toBeNull();
    expect(directionForKey('Escape')).toBeNull();
  });

  it('detects controls anywhere in a composed event path', () => {
    const input = document.createElement('input');
    const buttonChild = document.createElement('span');
    const button = document.createElement('button');
    button.append(buttonChild);

    expect(isEditableEventPath([input, document.body])).toBe(true);
    expect(isEditableEventPath([buttonChild, button, document.body])).toBe(true);
    expect(isEditableEventPath([document.createElement('p'), document.body])).toBe(false);
  });
});
