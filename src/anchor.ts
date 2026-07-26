import type { SemanticAnchor } from './model';

export function serializeAnchor(anchor: SemanticAnchor): string {
  return `${encodeURIComponent(anchor.blockId)}:${anchor.characterOffset}:${anchor.affinity}`;
}

export function parseAnchor(value: string | null): SemanticAnchor | null {
  if (!value) return null;
  const match = /^(.+):(\d+):(forward|backward)$/.exec(value);
  if (!match) return null;
  return {
    blockId: decodeURIComponent(match[1] ?? ''),
    characterOffset: Number(match[2]),
    affinity: match[3] as SemanticAnchor['affinity'],
  };
}

export function closestAnchorBlock(
  anchor: SemanticAnchor,
  blockIds: readonly string[],
): string | null {
  if (blockIds.includes(anchor.blockId)) return anchor.blockId;
  const indexMatch = /^b-(\d+)-/.exec(anchor.blockId);
  if (!indexMatch || blockIds.length === 0) return blockIds[0] ?? null;
  const desired = Number(indexMatch[1]);
  return blockIds.reduce((best, candidate) => {
    const candidateIndex = Number(/^b-(\d+)-/.exec(candidate)?.[1] ?? 0);
    const bestIndex = Number(/^b-(\d+)-/.exec(best)?.[1] ?? 0);
    return Math.abs(candidateIndex - desired) < Math.abs(bestIndex - desired) ? candidate : best;
  });
}
