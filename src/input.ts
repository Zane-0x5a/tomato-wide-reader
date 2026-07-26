export const READER_NAVIGATION_EVENT = 'tomato-wide-reader:navigate';

export type NavigationDirection = 'previous' | 'next';

export function directionForKey(key: string): NavigationDirection | null {
  if (['ArrowRight', 'PageDown', ' '].includes(key)) return 'next';
  if (['ArrowLeft', 'PageUp'].includes(key)) return 'previous';
  return null;
}

export function isEditableEventPath(path: EventTarget[]): boolean {
  return path.some((target) => target instanceof Element
    && Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]')));
}
