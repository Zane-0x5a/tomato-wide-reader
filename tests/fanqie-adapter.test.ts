import { describe, expect, it, vi } from 'vitest';
import {
  chapterFingerprint,
  extractFanqieChapter,
  FanqieExtractionError,
  fetchChapterDocument,
  fetchFanqieDirectory,
  navigateBackNative,
  navigateNative,
  prefetchChapterDocument,
} from '../src/site/fanqie';

function documentFrom(body: string): Document {
  return new DOMParser().parseFromString(`<html><body>${body}</body></html>`, 'text/html');
}

describe('Fanqie adapter contract', () => {
  it('extracts ordered paragraphs, decodes PUA, images, and directory entries', () => {
    const source = documentFrom(`
      <h1 class="muye-reader-title">测试章节</h1>
      <main class="muye-reader-content">
        <p>第一段。</p><p>\uE3E9\uE3EA\uE3EC。</p><img src="https://example.test/a.jpg" alt="插图">
      </main>
      <a href="https://fanqienovel.com/reader/100">上一章</a>
      <a href="https://fanqienovel.com/reader/101">测试章节</a>
    `);
    const chapter = extractFanqieChapter(source, 'https://fanqienovel.com/reader/101');
    expect(chapter.blocks.map((block) => block.kind)).toEqual(['paragraph', 'paragraph', 'image']);
    expect(chapter.blocks[1]).toMatchObject({ text: '在主家。' });
    expect(chapter.directory.find((entry) => entry.current)?.itemId).toBe('101');
  });

  it('fails open when any body glyph cannot be decoded', () => {
    const source = documentFrom('<main class="muye-reader-content"><p>正常</p><p>未知\uE000</p></main>');
    expect(() => extractFanqieChapter(source, 'https://fanqienovel.com/reader/101')).toThrowError(
      expect.objectContaining({ code: 'unknown-glyphs' }) as FanqieExtractionError,
    );
  });

  it('rejects promotional-only and structurally incomplete content', () => {
    const source = documentFrom('<main class="muye-reader-content"><p>下载番茄小说客户端</p></main>');
    expect(() => extractFanqieChapter(source, 'https://fanqienovel.com/reader/101')).toThrowError(
      expect.objectContaining({ code: 'insufficient-blocks' }) as FanqieExtractionError,
    );
  });

  it('does not activate on unsupported routes', () => {
    const source = documentFrom('<main class="muye-reader-content"><p>一</p><p>二</p></main>');
    expect(() => extractFanqieChapter(source, 'https://fanqienovel.com/page/101')).toThrowError(
      expect.objectContaining({ code: 'unsupported-route' }) as FanqieExtractionError,
    );
  });

  it('loads and normalizes the official directory response when the DOM has no chapter links', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      data: {
        chapterListWithVolume: [[
          { itemId: '100', title: '第1章 开始' },
          { itemId: '101', title: '第2章 当前' },
        ]],
      },
    }), { status: 200 })) as unknown as typeof fetch;

    const directory = await fetchFanqieDirectory('book-1', '101', fetcher);

    expect(fetcher).toHaveBeenCalledWith('/api/reader/directory/detail?bookId=book-1', expect.objectContaining({ credentials: 'include' }));
    expect(directory).toHaveLength(2);
    expect(directory[1]).toEqual({
      itemId: '101',
      title: '第2章 当前',
      href: '/reader/101?enter_from=reader',
      current: true,
    });
  });

  it('keeps reading available when the directory endpoint fails or changes shape', async () => {
    const rejected = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const changed = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 })) as unknown as typeof fetch;

    await expect(fetchFanqieDirectory('book-1', '101', rejected)).resolves.toEqual([]);
    await expect(fetchFanqieDirectory('book-1', '101', changed)).resolves.toEqual([]);
  });

  it('navigates via directory href and never clicks bare 下一页 controls', () => {
    const pageTurn = document.createElement('button');
    pageTurn.textContent = '下一页';
    const pageClick = vi.fn();
    pageTurn.addEventListener('click', pageClick);
    document.body.append(pageTurn);

    const assigned: string[] = [];
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        href: 'https://fanqienovel.com/reader/101',
        assign: (url: string) => { assigned.push(url); },
      },
    });

    const ok = navigateNative('next', [
      { itemId: '101', title: '当前', href: '/reader/101', current: true },
      { itemId: '102', title: '下一章', href: '/reader/102?enter_from=reader', current: false },
    ]);

    expect(ok).toBe(true);
    expect(assigned.some((url) => url.includes('/reader/102'))).toBe(true);
    expect(pageClick).not.toHaveBeenCalled();

    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    pageTurn.remove();
  });

  it('fingerprints chapter bodies so SPA-stale content can be detected', () => {
    const a = chapterFingerprint({
      title: '第1章',
      blocks: [{ id: '1', kind: 'paragraph', text: '甲文段' }],
    });
    const b = chapterFingerprint({
      title: '第1章',
      blocks: [{ id: '1', kind: 'paragraph', text: '乙文段' }],
    });
    expect(a).not.toBe(b);
  });

  it('fetches and caches a chapter document from HTML', async () => {
    const html = `<!doctype html><html><body>
      <h1 class="muye-reader-title">远程章</h1>
      <main class="muye-reader-content"><p>第一段文字。</p><p>第二段文字。</p></main>
    </body></html>`;
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    );
    // Absolute URL needs a base — jsdom provides location.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: new URL('https://fanqienovel.com/reader/101'),
    });

    const chapter = await fetchChapterDocument('/reader/202?enter_from=reader', {
      directoryFallback: [
        { itemId: '101', title: '上', href: '/reader/101', current: false },
        { itemId: '202', title: '远程章', href: '/reader/202', current: false },
      ],
    });
    expect(chapter.itemId).toBe('202');
    expect(chapter.blocks).toHaveLength(2);
    expect(chapter.directory.find((e) => e.current)?.itemId).toBe('202');

    // Second call hits cache — no extra fetch for same item.
    const calls = fetcher.mock.calls.length;
    await fetchChapterDocument('/reader/202');
    expect(fetcher.mock.calls.length).toBe(calls);

    prefetchChapterDocument('/reader/303');
    fetcher.mockRestore();
  });

  it('leaves the reader via the book detail page, never previous chapter', () => {
    const assigned: string[] = [];
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        href: 'https://fanqienovel.com/reader/101',
        origin: 'https://fanqienovel.com',
        assign: (url: string) => { assigned.push(String(url)); },
      },
    });

    // A misleading "返回" that would history.back into previous chapter must be ignored.
    const fakeBack = document.createElement('button');
    fakeBack.textContent = '返回';
    const fakeClick = vi.fn();
    fakeBack.addEventListener('click', fakeClick);
    document.body.append(fakeBack);

    expect(navigateBackNative('999888')).toBe(true);
    expect(fakeClick).not.toHaveBeenCalled();
    expect(assigned.some((url) => url.includes('/page/999888'))).toBe(true);

    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    fakeBack.remove();
  });
});
