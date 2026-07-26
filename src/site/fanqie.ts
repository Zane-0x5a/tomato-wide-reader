import type { ChapterBlock, ChapterDocument, DirectoryEntry } from '../model';
import { containsPrivateUse, normalizeFanqieText, stableBlockId } from '../content/normalize';

const CONTENT_SELECTORS = [
  '.muye-reader-content',
  '[class*="reader-content"]',
  '[class*="chapter-content"]',
  'article',
];

const TITLE_SELECTORS = [
  '.muye-reader-title',
  '[class*="reader-title"]',
  '[class*="chapter-title"]',
  'article h1',
  'h1',
];

export class FanqieExtractionError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

export async function waitForFanqieChapter(
  timeoutMs = 12_000,
  options: { previousItemId?: string | null; previousFingerprint?: string | null } = {},
): Promise<ChapterDocument> {
  const started = performance.now();
  let lastError: unknown;
  while (performance.now() - started < timeoutMs) {
    try {
      const expectedItemId = itemIdFromUrl(location.href);
      if (!expectedItemId) throw new FanqieExtractionError('不是受支持的番茄阅读页', 'unsupported-route');

      const chapter = extractFanqieChapter(document, location.href);
      // SPA nav often updates the URL before the article body; never accept a stale chapter.
      if (chapter.itemId !== expectedItemId) {
        throw new FanqieExtractionError('章节正文尚未与地址同步', 'stale-chapter');
      }
      // After an intentional chapter change, keep waiting until the DOM leaves the previous item/content.
      if (options.previousItemId && chapter.itemId === options.previousItemId) {
        throw new FanqieExtractionError('仍停留在上一章正文', 'chapter-not-advanced');
      }
      if (options.previousFingerprint && chapterFingerprint(chapter) === options.previousFingerprint) {
        throw new FanqieExtractionError('章节正文尚未切换', 'content-not-advanced');
      }

      if (chapter.directory.length < 2 && chapter.bookId) {
        const directory = await fetchFanqieDirectory(chapter.bookId, chapter.itemId);
        if (directory.length > 0) chapter.directory = directory;
      }
      return chapter;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError instanceof Error ? lastError : new FanqieExtractionError('章节加载超时', 'timeout');
}

export function itemIdFromUrl(url: string): string | null {
  try {
    return /\/reader\/(\d+)/.exec(new URL(url, location.origin).pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Stable enough to detect "SPA still showing the previous chapter body". */
export function chapterFingerprint(chapter: Pick<ChapterDocument, 'title' | 'blocks'>): string {
  const parts = chapter.blocks.slice(0, 6).map((block) => (
    block.kind === 'paragraph' ? block.text.slice(0, 48) : `img:${block.src}`
  ));
  return `${chapter.title}|${parts.join('|')}`;
}

export async function fetchFanqieDirectory(
  bookId: string,
  currentItemId: string,
  fetcher: typeof fetch = fetch,
): Promise<DirectoryEntry[]> {
  try {
    const response = await fetcher(`/api/reader/directory/detail?bookId=${encodeURIComponent(bookId)}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return [];
    const payload: unknown = await response.json();
    if (!isRecord(payload) || payload.code !== 0 || !isRecord(payload.data)) return [];
    const groups = payload.data.chapterListWithVolume;
    if (!Array.isArray(groups)) return [];

    const seen = new Set<string>();
    const entries: DirectoryEntry[] = [];
    for (const group of groups) {
      const chapters = Array.isArray(group)
        ? group
        : isRecord(group)
          ? firstArray(group.chapterList, group.chapter_list, group.itemList)
          : [];
      for (const value of chapters) {
        if (!isRecord(value)) continue;
        const itemId = stringValue(value.itemId ?? value.item_id);
        const rawTitle = stringValue(value.title ?? value.chapterTitle ?? value.chapter_title);
        const title = normalizeFanqieText(rawTitle).text;
        if (!itemId || !title || seen.has(itemId)) continue;
        seen.add(itemId);
        entries.push({
          itemId,
          title,
          href: `/reader/${itemId}?enter_from=reader`,
          current: itemId === currentItemId,
        });
      }
    }
    return entries;
  } catch {
    return [];
  }
}

export function extractFanqieChapter(source: Document, url: string): ChapterDocument {
  const parsedUrl = new URL(url);
  const itemId = /\/reader\/(\d+)/.exec(parsedUrl.pathname)?.[1];
  if (!itemId) throw new FanqieExtractionError('不是受支持的番茄阅读页', 'unsupported-route');

  const root = firstMatching(source, CONTENT_SELECTORS);
  if (!root) throw new FanqieExtractionError('未找到可信正文区域', 'missing-content-root');

  const titleNode = firstMatching(source, TITLE_SELECTORS);
  const title = normalizeFanqieText(titleNode?.textContent ?? '').text || '当前章节';
  const candidates = [...root.querySelectorAll<HTMLElement>('p, img')];
  const blocks: ChapterBlock[] = [];
  const unknownPua = new Set<string>();

  for (const node of candidates) {
    if (node.matches('img')) {
      const image = node as HTMLImageElement;
      const src = image.currentSrc || image.src || image.dataset.src || '';
      if (src && !isPromotional(node)) {
        blocks.push({ id: stableBlockId(blocks.length, src), kind: 'image', src, alt: image.alt || '章节插图' });
      }
      continue;
    }
    if (isPromotional(node)) continue;
    const normalized = normalizeFanqieText(node.textContent ?? '');
    normalized.unknownPua.forEach((value) => unknownPua.add(value));
    if (normalized.text) {
      blocks.push({ id: stableBlockId(blocks.length, normalized.text), kind: 'paragraph', text: normalized.text });
    }
  }

  if (blocks.length < 2) throw new FanqieExtractionError('正文块过少，保留原网页', 'insufficient-blocks');
  if (unknownPua.size > 0 || blocks.some((block) => block.kind === 'paragraph' && containsPrivateUse(block.text))) {
    throw new FanqieExtractionError('发现无法解码的正文字符，保留原网页', 'unknown-glyphs');
  }

  return {
    itemId,
    bookId: readBookId(source),
    title,
    blocks,
    directory: extractDirectory(source, itemId),
    source: 'fanqie-dom',
  };
}

function firstMatching(source: ParentNode, selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const match = source.querySelector<HTMLElement>(selector);
    if (match) return match;
  }
  return null;
}

function isPromotional(node: Element): boolean {
  const context = `${node.className} ${node.closest('[class]')?.className ?? ''} ${node.textContent ?? ''}`;
  return /下载|二维码|扫码|客户端|奖励|打赏|评论|推荐|advert|qrcode/i.test(context);
}

function readBookId(source: Document): string | null {
  const html = source.documentElement.innerHTML;
  return /["']bookId["']\s*:\s*["']?(\d+)/.exec(html)?.[1]
    ?? /["']book_id["']\s*:\s*["']?(\d+)/.exec(html)?.[1]
    ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function firstArray(...values: unknown[]): unknown[] {
  return values.find(Array.isArray) ?? [];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function extractDirectory(source: Document, itemId: string): DirectoryEntry[] {
  const seen = new Set<string>();
  const entries: DirectoryEntry[] = [];
  source.querySelectorAll<HTMLAnchorElement>('a[href*="/reader/"]').forEach((link) => {
    const id = /\/reader\/(\d+)/.exec(link.href)?.[1];
    const title = normalizeFanqieText(link.textContent ?? '').text;
    if (!id || !title || seen.has(id)) return;
    seen.add(id);
    entries.push({ itemId: id, title, href: link.href, current: id === itemId });
  });
  return entries;
}

const chapterCache = new Map<string, ChapterDocument>();

/** Soft chapter load: fetch + parse without tearing down the immersive shell. */
export async function fetchChapterDocument(
  href: string,
  options: { directoryFallback?: DirectoryEntry[]; bookId?: string | null } = {},
): Promise<ChapterDocument> {
  const absolute = new URL(href, location.href);
  const itemId = itemIdFromUrl(absolute.href);
  if (!itemId) throw new FanqieExtractionError('不是受支持的番茄阅读页', 'unsupported-route');

  const cached = chapterCache.get(itemId);
  if (cached) {
    return {
      ...cached,
      directory: markCurrent(options.directoryFallback ?? cached.directory, itemId),
    };
  }

  const response = await fetch(absolute.href, {
    credentials: 'include',
    headers: { Accept: 'text/html,application/xhtml+xml' },
  });
  if (!response.ok) throw new FanqieExtractionError(`章节请求失败（${response.status}）`, 'fetch-failed');
  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const chapter = extractFanqieChapter(doc, absolute.href);

  if (chapter.directory.length < 2) {
    const fallback = options.directoryFallback;
    if (fallback && fallback.length > 0) {
      chapter.directory = markCurrent(fallback, chapter.itemId);
    } else if (chapter.bookId || options.bookId) {
      const directory = await fetchFanqieDirectory(chapter.bookId ?? options.bookId!, chapter.itemId);
      if (directory.length > 0) chapter.directory = directory;
    }
  } else {
    chapter.directory = markCurrent(chapter.directory, chapter.itemId);
  }

  chapterCache.set(chapter.itemId, chapter);
  // Bound memory: keep a small sliding window of chapters.
  if (chapterCache.size > 12) {
    const oldest = chapterCache.keys().next().value;
    if (oldest) chapterCache.delete(oldest);
  }
  return chapter;
}

export function prefetchChapterDocument(
  href: string,
  options: { directoryFallback?: DirectoryEntry[]; bookId?: string | null } = {},
): void {
  const itemId = itemIdFromUrl(href);
  if (!itemId || chapterCache.has(itemId)) return;
  void fetchChapterDocument(href, options).catch(() => {
    /* prefetch is best-effort */
  });
}

function markCurrent(directory: DirectoryEntry[], itemId: string): DirectoryEntry[] {
  return directory.map((entry) => ({ ...entry, current: entry.itemId === itemId }));
}

/**
 * Leave the immersive reader and go back to the pre-book page.
 *
 * User intent: "return to where I was before opening this book" — usually the
 * book detail page (`/page/{bookId}`), never previous chapter / previous page.
 *
 * Do NOT click opaque "返回" buttons under the inert cover: they often implement
 * history.back() and land on the previous chapter after soft navigation.
 * Prefer an explicit navigation to the book page when bookId is known.
 */
export function navigateBackNative(bookId?: string | null): boolean {
  const resolvedBookId = bookId || readBookId(document);

  // Hard leave: book detail is the normal fanqie "返回" destination from reader.
  if (resolvedBookId) {
    const dest = new URL(`/page/${resolvedBookId}`, location.origin).href;
    // Use assign so this is a real document navigation away from /reader/*.
    location.assign(dest);
    return true;
  }

  // No book id: try a non-reader anchor in the page (bookshelf / home / page).
  const exitLink = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
    .map((link, index) => ({ link, index }))
    .filter(({ link }) => {
      if (isPromotional(link)) return false;
      try {
        const path = new URL(link.href, location.href).pathname;
        if (/\/reader\//.test(path)) return false;
        return /\/page\/\d+|library|bookshelf|\/book\//i.test(path) || path === '/';
      } catch {
        return false;
      }
    })
    .sort((a, b) => {
      const score = (link: HTMLAnchorElement) => {
        try {
          const path = new URL(link.href, location.href).pathname;
          if (/\/page\/\d+/.test(path)) return 5;
          if (path === '/') return 1;
          return 3;
        } catch {
          return 0;
        }
      };
      return score(b.link) - score(a.link) || a.index - b.index;
    })[0]?.link;

  if (exitLink) {
    location.assign(exitLink.href);
    return true;
  }

  location.assign('/');
  return true;
}

/**
 * Advance/retreat chapters without touching in-page "下一页" pagination controls
 * (those can re-scroll the current chapter to the top and look like a failed chapter change).
 */
export function navigateNative(direction: 'previous' | 'next', directory: DirectoryEntry[] = []): boolean {
  const currentIndex = directory.findIndex((entry) => entry.current);
  if (currentIndex >= 0) {
    const target = directory[direction === 'next' ? currentIndex + 1 : currentIndex - 1];
    if (target?.href) {
      const absolute = new URL(target.href, location.href).href;
      if (absolute !== location.href) {
        location.assign(absolute);
        return true;
      }
    }
  }

  // Chapter-only labels — never match bare "下一页/上一页" (page-turn, not chapter-turn).
  const chapterPattern = direction === 'next' ? /下一章/ : /上一章/;
  const controls = [...document.querySelectorAll<HTMLElement>('a, button')];
  const ranked = controls
    .map((element, index) => ({ element, index, text: (element.textContent ?? '').replace(/\s+/g, '') }))
    .filter(({ element, text }) => chapterPattern.test(text) && !isPromotional(element) && !/页/.test(text.replace(chapterPattern, '')));

  ranked.sort((a, b) => {
    const score = (item: typeof a) => {
      let value = 0;
      if (item.element instanceof HTMLAnchorElement && /\/reader\/\d+/.test(item.element.href)) value += 4;
      if (item.text === (direction === 'next' ? '下一章' : '上一章')) value += 2;
      return value;
    };
    return score(b) - score(a) || a.index - b.index;
  });

  const target = ranked[0]?.element;
  if (!target) return false;
  target.click();
  return true;
}
