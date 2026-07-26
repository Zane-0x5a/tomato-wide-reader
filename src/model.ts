export type ChapterBlock =
  | { id: string; kind: 'paragraph'; text: string }
  | { id: string; kind: 'image'; src: string; alt: string };

export interface ChapterDocument {
  bookId: string | null;
  itemId: string;
  title: string;
  blocks: ChapterBlock[];
  directory: DirectoryEntry[];
  source: 'fanqie-dom';
}

export interface DirectoryEntry {
  itemId: string;
  title: string;
  href: string;
  current: boolean;
}

export interface SemanticAnchor {
  blockId: string;
  characterOffset: number;
  affinity: 'forward' | 'backward';
}

export interface ReaderSettings {
  theme: 'system' | 'light' | 'dark';
  fontFamily: 'sans' | 'serif';
  fontSize: number;
  lineHeight: number;
  paragraphGap: number;
  columnGap: number;
  pageMargin: number;
  showPageIndicator: boolean;
}
