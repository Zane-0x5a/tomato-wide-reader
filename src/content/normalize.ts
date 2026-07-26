import glyphMapJson from '../../generated/fanqie-glyph-map.json';

const glyphMap = glyphMapJson as Record<string, string>;
const PUA = /[\uE000-\uF8FF]/u;

export interface NormalizedText {
  text: string;
  decoded: number;
  unknownPua: string[];
}

export function normalizeFanqieText(input: string): NormalizedText {
  let decoded = 0;
  const unknown = new Set<string>();
  const text = input
    .normalize('NFC')
    .replace(/[\uE000-\uF8FF]/gu, (character) => {
      const key = character.codePointAt(0)?.toString(16).toUpperCase() ?? '';
      const replacement = glyphMap[key];
      if (!replacement) {
        unknown.add(key);
        return character;
      }
      decoded += 1;
      return replacement;
    })
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();

  return { text, decoded, unknownPua: [...unknown] };
}

export function containsPrivateUse(text: string): boolean {
  return PUA.test(text);
}

export function stableBlockId(index: number, text: string): string {
  let hash = 0x811c9dc5;
  for (const character of `${index}:${text}`) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return `b-${index}-${(hash >>> 0).toString(36)}`;
}
