import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Moon,
  Search,
  Settings2,
  Sun,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChapterDocument, ReaderSettings, SemanticAnchor } from '../model';
import { closestAnchorBlock } from '../anchor';
import { READER_NAVIGATION_EVENT, type NavigationDirection } from '../input';
import { loadAnchor, saveAnchor, saveSettings } from '../settings';
import {
  chapterFingerprint,
  fetchChapterDocument,
  navigateBackNative,
  navigateNative,
  prefetchChapterDocument,
} from '../site/fanqie';

interface ReaderAppProps {
  chapter: ChapterDocument;
  initialSettings: ReaderSettings;
  onExit: () => void;
  /** Soft chapter swap (no host remount). Content script updates history. */
  onChapterChange?: (chapter: ChapterDocument) => void;
}

interface LayoutState {
  columnsPerSpread: 1 | 2;
  totalColumns: number;
  totalSpreads: number;
  spreadStep: number;
  columnStep: number;
  /** When odd column count in 2-col mode, last page is one column on the left. */
  trailingHalf: boolean;
}

const LAYOUT_SETTING_KEYS = new Set<keyof ReaderSettings>([
  'fontFamily',
  'fontSize',
  'lineHeight',
  'paragraphGap',
  'columnGap',
  'pageMargin',
]);

export function ReaderApp({ chapter: chapterProp, initialSettings, onExit: _onExit, onChapterChange }: ReaderAppProps) {
  const [chapter, setChapter] = useState(chapterProp);
  const [settings, setSettings] = useState(initialSettings);
  const [spread, setSpread] = useState(0);
  const [layout, setLayout] = useState<LayoutState>({
    columnsPerSpread: 2,
    totalColumns: 1,
    totalSpreads: 1,
    spreadStep: 1,
    columnStep: 1,
    trailingHalf: false,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [directoryQuery, setDirectoryQuery] = useState('');
  const [motion, setMotion] = useState<'next' | 'previous' | null>(null);
  const [motionKey, setMotionKey] = useState(0);
  const [chapterBusy, setChapterBusy] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const directoryNavRef = useRef<HTMLElement>(null);
  const saveTimer = useRef<number | null>(null);
  const wheelAccumulator = useRef(0);
  const wheelLockUntil = useRef(0);
  const resizeAnchor = useRef<SemanticAnchor | null>(null);
  const settingsSessionAnchor = useRef<SemanticAnchor | null>(null);
  const chapterNavLockUntil = useRef(0);
  const chapterNavInFlight = useRef(false);
  const spreadRef = useRef(0);
  const layoutRef = useRef(layout);
  const motionTimer = useRef(0);
  const openAtEnd = useRef(sessionStorage.getItem('tomato-wide-reader:open-at-end') === chapterProp.itemId);
  const pendingOpenAtEnd = useRef(false);

  spreadRef.current = spread;
  layoutRef.current = layout;

  // Parent re-render (hard route remount) wins over local soft-swap state.
  useEffect(() => {
    setChapter(chapterProp);
    setSpread(0);
    spreadRef.current = 0;
    openAtEnd.current = sessionStorage.getItem('tomato-wide-reader:open-at-end') === chapterProp.itemId;
  }, [chapterProp]);

  const resolvedTheme = settings.theme === 'system' ? 'system' : settings.theme;
  const style = {
    '--twr-font-size': `${settings.fontSize}px`,
    '--twr-line-height': String(settings.lineHeight),
    '--twr-paragraph-gap': `${settings.paragraphGap}em`,
    '--twr-column-gap': `${settings.columnGap}px`,
    '--twr-page-margin': `${settings.pageMargin}px`,
  } as React.CSSProperties;

  const captureAnchor = useCallback((): SemanticAnchor | null => {
    const frame = frameRef.current;
    const article = articleRef.current;
    if (!frame || !article) return null;
    const frameRect = frame.getBoundingClientRect();
    const blocks = [...article.querySelectorAll<HTMLElement>('[data-block-id]:not([data-block-id="column-pad"])')];
    const candidates = blocks.flatMap((block) => [...block.getClientRects()]
      .filter((rect) => intersects(rect, frameRect))
      .map((rect) => ({ block, rect })));
    candidates.sort((a, b) => a.rect.left - b.rect.left || a.rect.top - b.rect.top);
    const visible = candidates[0]?.block ?? blocks.at(-1);
    if (!visible) return null;
    return {
      blockId: visible.dataset.blockId!,
      characterOffset: firstVisibleCharacterOffset(visible, frameRect),
      affinity: 'forward',
    };
  }, []);

  const measure = useCallback((restoreAnchor?: SemanticAnchor | null) => {
    const frame = frameRef.current;
    const article = articleRef.current;
    if (!frame || !article) return;
    const measured = readLayoutGeometry(frame, article);
    const previous = layoutRef.current;
    const atOrPastEnd = spreadRef.current >= Math.max(0, previous.totalSpreads - 1);
    // Multicol + overflow:hidden often under-reports scrollWidth while scrolled near the end.
    // Never accept a shrink that would yank the reader backward to an earlier page.
    const spuriousShrink = !restoreAnchor
      && measured.totalSpreads < previous.totalSpreads
      && (
        measured.totalSpreads <= spreadRef.current
        || (atOrPastEnd && measured.totalSpreads < previous.totalSpreads)
        || (previous.totalSpreads > 1 && measured.totalSpreads <= 1)
      );
    const nextLayout = spuriousShrink
      ? {
          ...previous,
          // Allow trailingHalf to flip on so the odd last page can pad correctly later.
          trailingHalf: measured.trailingHalf || previous.trailingHalf,
          // If measurement only grew columnsPerSpread mismatch, keep previous geometry.
        }
      : measured;
    const { spreadStep, totalSpreads } = nextLayout;
    layoutRef.current = nextLayout;
    setLayout((current) => (layoutNearlyEqual(current, nextLayout) ? current : nextLayout));

    const anchor = restoreAnchor;
    if (anchor) {
      const ids = [...article.querySelectorAll<HTMLElement>('[data-block-id]:not([data-block-id="column-pad"])')].map((node) => node.dataset.blockId!);
      const targetId = closestAnchorBlock(anchor, ids);
      const target = targetId ? article.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(targetId)}"]`) : null;
      const characterRect = target ? characterRectAt(target, anchor.characterOffset) : null;
      const frameRect = frame.getBoundingClientRect();
      const logicalLeft = characterRect
        ? characterRect.left - frameRect.left + frame.scrollLeft
        : target?.offsetLeft ?? 0;
      const targetSpread = Math.floor(Math.max(0, logicalLeft) / Math.max(1, spreadStep));
      article.dataset.restoredAnchor = `${anchor.blockId}:${anchor.characterOffset}`;
      article.dataset.restoredSpread = String(targetSpread);
      const nextSpread = Math.min(Math.max(0, totalSpreads - 1), Math.max(0, targetSpread));
      spreadRef.current = nextSpread;
      setSpread(nextSpread);
      resizeAnchor.current = null;
    } else if (!spuriousShrink) {
      setSpread((current) => {
        // Only clamp upward-overflow after a real (non-spurious) shrink.
        const next = Math.min(Math.max(0, totalSpreads - 1), current);
        spreadRef.current = next;
        return next;
      });
    }
  }, []);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const article = articleRef.current;
    if (!frame || !article) return;
    let frameId = requestAnimationFrame(() => measure(resizeAnchor.current));
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(() => measure(resizeAnchor.current));
    });
    observer.observe(frame);
    observer.observe(article);
    document.fonts.ready.then(() => measure(resizeAnchor.current));
    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [
    captureAnchor,
    chapter.itemId,
    measure,
    settings.columnGap,
    settings.fontFamily,
    settings.fontSize,
    settings.lineHeight,
    settings.pageMargin,
    settings.paragraphGap,
  ]);

  useEffect(() => {
    if (openAtEnd.current || pendingOpenAtEnd.current) {
      let cancelled = false;
      let timer = 0;
      let attempts = 0;
      const positionAtEnd = () => {
        if (cancelled) return;
        const frame = frameRef.current;
        const article = articleRef.current;
        if (!frame || !article) {
          timer = window.setTimeout(positionAtEnd, 50);
          return;
        }
        const finalLayout = readLayoutGeometry(frame, article);
        attempts += 1;
        if (finalLayout.totalSpreads === 1 && finalLayout.totalColumns <= 1 && attempts < 12) {
          timer = window.setTimeout(positionAtEnd, 50);
          return;
        }
        const finalSpread = finalLayout.totalSpreads - 1;
        resizeAnchor.current = null;
        layoutRef.current = finalLayout;
        setLayout(finalLayout);
        spreadRef.current = finalSpread;
        setSpread(finalSpread);
        frame.scrollTo({ left: scrollLeftForSpread(finalSpread, finalLayout), behavior: 'instant' });
        openAtEnd.current = false;
        pendingOpenAtEnd.current = false;
        sessionStorage.removeItem('tomato-wide-reader:open-at-end');
      };
      requestAnimationFrame(positionAtEnd);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }
    loadAnchor(chapter.itemId).then((anchor) => {
      if (anchor) requestAnimationFrame(() => measure(anchor));
    });
  }, [chapter.itemId, measure]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    // Multicol overflow becomes frame.scrollWidth when article.overflow is visible.
    const targetLeft = scrollLeftForSpread(spread, layoutRef.current);
    if (Math.abs(frame.scrollLeft - targetLeft) > 0.5) {
      frame.scrollTo({ left: targetLeft, behavior: 'instant' });
    }
    const settleTimer = window.setTimeout(() => {
      if (Math.abs(frame.scrollLeft - targetLeft) > 2) return;
      const anchor = captureAnchor();
      if (!anchor) return;
      resizeAnchor.current = anchor;
      if (articleRef.current) {
        articleRef.current.dataset.currentAnchor = `${anchor.blockId}:${anchor.characterOffset}`;
      }
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => saveAnchor(chapter.itemId, anchor), 350);
    }, 190);
    return () => {
      window.clearTimeout(settleTimer);
    };
  }, [chapter.itemId, spread, layout.spreadStep, captureAnchor]);

  // Prefetch adjacent chapters so boundary turns feel like in-chapter page turns.
  useEffect(() => {
    const index = chapter.directory.findIndex((entry) => entry.current);
    if (index < 0) return;
    const opts = { directoryFallback: chapter.directory, bookId: chapter.bookId };
    const next = chapter.directory[index + 1];
    const prev = chapter.directory[index - 1];
    if (next) prefetchChapterDocument(next.href, opts);
    if (prev) prefetchChapterDocument(prev.href, opts);
  }, [chapter]);

  const playPageMotion = useCallback((direction: 'previous' | 'next') => {
    if (motionTimer.current) window.clearTimeout(motionTimer.current);
    setMotion(direction);
    setMotionKey((key) => key + 1);
    motionTimer.current = window.setTimeout(() => {
      setMotion((current) => (current === direction ? null : current));
      motionTimer.current = 0;
    }, 170);
  }, []);

  // Restart page-turn animation on every turn (including consecutive same-direction).
  useLayoutEffect(() => {
    if (!motion || !frameRef.current) return;
    const node = frameRef.current;
    node.style.animation = 'none';
    void node.offsetWidth;
    node.style.animation = '';
  }, [motion, motionKey]);

  const goToAdjacentChapter = useCallback(async (direction: 'previous' | 'next') => {
    if (chapterNavInFlight.current || chapterBusy) return false;
    const now = performance.now();
    // Short debounce only — long locks made boundary keypresses feel like they needed two taps.
    if (now < chapterNavLockUntil.current) return false;
    chapterNavLockUntil.current = now + 320;
    chapterNavInFlight.current = true;

    // Prefer itemId over entry.current — DOM/API directories sometimes mark the wrong row
    // (or none) as current, which sent "next" to an arbitrary chapter.
    const indexById = chapter.directory.findIndex((entry) => entry.itemId === chapter.itemId);
    const indexByFlag = chapter.directory.findIndex((entry) => entry.current);
    const index = indexById >= 0 ? indexById : indexByFlag;
    const target = index >= 0
      ? chapter.directory[direction === 'next' ? index + 1 : index - 1]
      : undefined;

    // Refuse a no-op / self-target (would look like a random jump after remount).
    if (target?.itemId && target.itemId === chapter.itemId) {
      chapterNavInFlight.current = false;
      chapterNavLockUntil.current = 0;
      return false;
    }

    if (target?.href) {
      setChapterBusy(true);
      try {
        const nextChapter = await fetchChapterDocument(target.href, {
          directoryFallback: chapter.directory,
          bookId: chapter.bookId,
        });
        if (nextChapter.itemId === chapter.itemId) {
          chapterNavLockUntil.current = 0;
          return false;
        }
        // Soft-swap: keep shell, swap body, reuse the same page-turn motion.
        if (direction === 'previous') pendingOpenAtEnd.current = true;
        else {
          pendingOpenAtEnd.current = false;
          sessionStorage.removeItem('tomato-wide-reader:open-at-end');
        }
        resizeAnchor.current = null;
        settingsSessionAnchor.current = null;
        setSpread(0);
        spreadRef.current = 0;
        setChapter(nextChapter);
        playPageMotion(direction);
        // Tell the content script BEFORE replaceState so the URL poller never sees a new
        // location while lastRenderedItemId still points at the previous chapter (that race
        // remounted from the still-stale host DOM and looked like a jump to an old chapter/page).
        onChapterChange?.(nextChapter);
        // replaceState (not pushState): chapter hops must not stack so browser/site "返回"
        // leaves the book instead of walking back one chapter at a time.
        history.replaceState(
          { tomatoWideReader: true, itemId: nextChapter.itemId },
          '',
          new URL(target.href, location.href).href,
        );
        return true;
      } catch (error) {
        console.warn('[tomato-wide-reader] soft chapter nav failed, falling back', error);
        chapterNavLockUntil.current = 0;
      } finally {
        setChapterBusy(false);
        chapterNavInFlight.current = false;
      }
    } else {
      chapterNavInFlight.current = false;
    }

    // Hard navigation fallback (site controls / missing directory).
    if (direction === 'previous') {
      const previous = index >= 0
        ? chapter.directory[index - 1]
        : chapter.directory.find((entry, i, entries) => entries[i + 1]?.current);
      if (previous) sessionStorage.setItem('tomato-wide-reader:open-at-end', previous.itemId);
    } else {
      sessionStorage.removeItem('tomato-wide-reader:open-at-end');
    }
    sessionStorage.setItem('tomato-wide-reader:pending-chapter-nav', JSON.stringify({
      fromItemId: chapter.itemId,
      fromFingerprint: chapterFingerprint(chapter),
      direction,
      at: Date.now(),
    }));
    // Pass itemId so navigateNative does not trust a wrong entry.current flag.
    const directoryForNav = indexById >= 0
      ? chapter.directory.map((entry) => ({ ...entry, current: entry.itemId === chapter.itemId }))
      : chapter.directory;
    const ok = navigateNative(direction, directoryForNav);
    if (!ok) {
      chapterNavLockUntil.current = 0;
      sessionStorage.removeItem('tomato-wide-reader:pending-chapter-nav');
    }
    return ok;
  }, [chapter, chapterBusy, onChapterChange, playPageMotion]);

  const turn = useCallback((direction: 'previous' | 'next') => {
    if (settingsOpen || directoryOpen || chapterBusy || chapterNavInFlight.current) return;

    const frame = frameRef.current;
    const article = articleRef.current;
    const previous = layoutRef.current;
    const currentBefore = spreadRef.current;
    const knownTotal = Math.max(1, previous.totalSpreads);

    // On a known last page of a multi-page chapter, do not remeasure before hopping:
    // end-of-scroll multicol often under-counts and either clamps backward or invents pages.
    const onKnownLastPage = direction === 'next' && knownTotal > 1 && currentBefore >= knownTotal - 1;
    const onKnownFirstPage = direction === 'previous' && currentBefore <= 0;

    if (onKnownLastPage) {
      void goToAdjacentChapter('next');
      return;
    }
    if (onKnownFirstPage && knownTotal > 1) {
      void goToAdjacentChapter('previous');
      return;
    }

    // Otherwise refresh geometry (growth always wins; shrink that would clamp current page is ignored).
    if (frame && article) {
      const fresh = readLayoutGeometry(frame, article);
      const wouldClampBack = fresh.totalSpreads < previous.totalSpreads
        && fresh.totalSpreads <= spreadRef.current
        && previous.totalSpreads > 1;
      if (!wouldClampBack && !layoutNearlyEqual(previous, fresh)) {
        layoutRef.current = fresh;
        setLayout(fresh);
      }
    }

    const current = spreadRef.current;
    const total = Math.max(1, layoutRef.current.totalSpreads);

    if (direction === 'next') {
      if (current < total - 1) {
        const next = current + 1;
        spreadRef.current = next;
        playPageMotion('next');
        setSpread(next);
        return;
      }
      void goToAdjacentChapter('next');
      return;
    }

    if (current > 0) {
      const next = current - 1;
      spreadRef.current = next;
      playPageMotion('previous');
      setSpread(next);
      return;
    }
    void goToAdjacentChapter('previous');
  }, [chapterBusy, directoryOpen, goToAdjacentChapter, playPageMotion, settingsOpen]);

  const closeSettings = useCallback(() => {
    settingsSessionAnchor.current = null;
    setSettingsOpen(false);
  }, []);

  const toggleSettings = useCallback(() => {
    setSettingsOpen((open) => {
      if (open) settingsSessionAnchor.current = null;
      else settingsSessionAnchor.current = captureAnchor();
      return !open;
    });
  }, [captureAnchor]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDirectoryOpen(false);
        closeSettings();
      }
    };
    const onNavigate = (event: Event) => turn((event as CustomEvent<NavigationDirection>).detail);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener(READER_NAVIGATION_EVENT, onNavigate);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener(READER_NAVIGATION_EVENT, onNavigate);
    };
  }, [closeSettings, turn]);

  const onWheel = useCallback((event: React.WheelEvent) => {
    if (settingsOpen || directoryOpen || chapterBusy) return;
    // Trackpad: accept both vertical two-finger scroll and horizontal swipe.
    // Prefer the dominant axis so diagonal flicks don't flip both ways.
    const absX = Math.abs(event.deltaX);
    const absY = Math.abs(event.deltaY);
    if (absX < 4 && absY < 4) return;
    const useHorizontal = absX > absY;
    const delta = useHorizontal ? event.deltaX : event.deltaY;
    // Natural trackpad: swipe left / scroll down → next page.
    const direction = Math.sign(delta) > 0 ? 'next' : 'previous';
    event.preventDefault();
    event.stopPropagation();
    const now = performance.now();
    if (now < wheelLockUntil.current) return;
    if (Math.sign(wheelAccumulator.current) !== Math.sign(delta)) wheelAccumulator.current = 0;
    wheelAccumulator.current += delta;
    // Slightly lower threshold for horizontal (trackpad swipe) than vertical.
    const threshold = useHorizontal ? 48 : 72;
    if (Math.abs(wheelAccumulator.current) >= threshold) {
      turn(direction);
      wheelAccumulator.current = 0;
      wheelLockUntil.current = now + 280;
    }
  }, [chapterBusy, directoryOpen, settingsOpen, turn]);

  const updateSettings = <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => {
    if (LAYOUT_SETTING_KEYS.has(key)) {
      settingsSessionAnchor.current ??= captureAnchor();
      resizeAnchor.current = settingsSessionAnchor.current;
    }
    setSettings((current) => {
      const next = { ...current, [key]: value };
      void saveSettings(next);
      return next;
    });
  };

  const filteredDirectory = useMemo(() => {
    const query = directoryQuery.trim().toLocaleLowerCase();
    return query
      ? chapter.directory.filter((entry) => entry.title.toLocaleLowerCase().includes(query))
      : chapter.directory;
  }, [chapter.directory, directoryQuery]);

  useLayoutEffect(() => {
    if (!directoryOpen || directoryQuery.trim()) return;
    const nav = directoryNavRef.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !current) return;
    nav.scrollTop = Math.max(0, current.offsetTop - nav.offsetTop - (nav.clientHeight - current.offsetHeight) / 2);
  }, [chapter.itemId, directoryOpen, directoryQuery]);

  return (
    <main
      className={`reader theme-${resolvedTheme} font-${settings.fontFamily}${chapterBusy ? ' chapter-busy' : ''}`}
      style={style}
      data-motion={motion ?? ''}
    >
      <div className="top-sensor" />
      <header className="top-controls" aria-label="阅读工具">
        <IconButton label="目录" onClick={() => setDirectoryOpen(true)}><BookOpen /></IconButton>
        <IconButton label="显示设置" onClick={toggleSettings}><Settings2 /></IconButton>
        <IconButton label={settings.theme === 'dark' ? '切换浅色' : '切换深色'} onClick={() => updateSettings('theme', settings.theme === 'dark' ? 'light' : 'dark')}>
          {settings.theme === 'dark' ? <Sun /> : <Moon />}
        </IconButton>
        <span className="top-title">{chapter.title}</span>
        <IconButton
          label="返回"
          onClick={() => {
            // Match the native fanqie "返回" control (leave reader), not a no-op shell unmount.
            navigateBackNative(chapter.bookId);
          }}
        ><X /></IconButton>
      </header>

      <button className="edge-zone edge-left" aria-label="上一页" onClick={() => turn('previous')}><ChevronLeft /></button>
      <div
        className={`page-frame motion-${motion ?? 'none'}`}
        ref={frameRef}
        onWheel={onWheel}
        data-motion-key={motionKey}
        data-spreads={layout.totalSpreads}
        data-spread={spread}
      >
        <article className="article" ref={articleRef} aria-label={chapter.title}>
          <h1 data-block-id="chapter-title">{chapter.title}</h1>
          {chapter.blocks.map((block) => block.kind === 'paragraph' ? (
            <p key={block.id} data-block-id={block.id}>{block.text}</p>
          ) : (
            <figure key={block.id} data-block-id={block.id}>
              <img src={block.src} alt={block.alt} loading="eager" />
              <figcaption>{block.alt}</figcaption>
            </figure>
          ))}
          {/* Pad one empty column when content ends on a left page so the last
              odd column stays left and the right half of the spread stays blank. */}
          {layout.columnsPerSpread === 2 && layout.trailingHalf && (
            <div className="column-pad" aria-hidden="true" data-block-id="column-pad" />
          )}
        </article>
      </div>
      <button className="edge-zone edge-right" aria-label="下一页" onClick={() => turn('next')}><ChevronRight /></button>

      {settings.showPageIndicator && <output className="page-indicator">{spread + 1}/{layout.totalSpreads}</output>}
      <div className="bottom-sensor" />
      <footer className="bottom-controls">
        <button onClick={() => goToAdjacentChapter('previous')}><ChevronLeft />上一章</button>
        <span>{chapter.title}<b>{spread + 1}/{layout.totalSpreads}</b></span>
        <button onClick={() => goToAdjacentChapter('next')}>下一章<ChevronRight /></button>
      </footer>

      {settingsOpen && <SettingsPanel settings={settings} advancedOpen={advancedOpen} setAdvancedOpen={setAdvancedOpen} update={updateSettings} close={closeSettings} />}
      {directoryOpen && (
        <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && setDirectoryOpen(false)}>
          <aside className="directory" aria-label="目录">
            <div className="drawer-heading"><div><strong>目录</strong><small>{chapter.directory.length} 章</small></div><IconButton label="关闭目录" onClick={() => setDirectoryOpen(false)}><X /></IconButton></div>
            <label className="search"><Search /><input value={directoryQuery} onChange={(event) => setDirectoryQuery(event.target.value)} placeholder="搜索章节" autoFocus /></label>
            <nav ref={directoryNavRef}>{filteredDirectory.length > 0
              ? filteredDirectory.map((entry) => <a key={entry.itemId} href={entry.href} aria-current={entry.current ? 'page' : undefined}>{entry.title}</a>)
              : <p className="directory-empty">站点目录尚未加载</p>}
            </nav>
          </aside>
        </div>
      )}
    </main>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button className="icon-button" aria-label={label} title={label} onClick={onClick}>{children}</button>;
}

function SettingsPanel({ settings, advancedOpen, setAdvancedOpen, update, close }: {
  settings: ReaderSettings;
  advancedOpen: boolean;
  setAdvancedOpen: (value: boolean) => void;
  update: <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => void;
  close: () => void;
}) {
  return <section className="settings-panel" aria-label="显示设置">
    <div className="panel-heading"><strong>显示设置</strong><IconButton label="关闭设置" onClick={close}><X /></IconButton></div>
    <label>字号</label><div className="segments">{[18, 20, 22].map((size) => <button key={size} aria-pressed={settings.fontSize === size} onClick={() => update('fontSize', size)}>{size}</button>)}</div>
    <label>主题</label><div className="segments">{(['light', 'dark', 'system'] as const).map((theme) => <button key={theme} aria-pressed={settings.theme === theme} onClick={() => update('theme', theme)}>{theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : '跟随系统'}</button>)}</div>
    <label>字体</label><div className="segments"><button aria-pressed={settings.fontFamily === 'sans'} onClick={() => update('fontFamily', 'sans')}>黑体</button><button aria-pressed={settings.fontFamily === 'serif'} onClick={() => update('fontFamily', 'serif')}>宋体</button></div>
    <label className="check"><input type="checkbox" checked={settings.showPageIndicator} onChange={(event) => update('showPageIndicator', event.target.checked)} />显示页码</label>
    <button className="advanced-toggle" onClick={() => setAdvancedOpen(!advancedOpen)}>高级设置<ChevronDown data-open={advancedOpen} /></button>
    {advancedOpen && <div className="advanced">
      <Range label="行高" value={settings.lineHeight} min={1.4} max={2.6} step={0.02} onChange={(value) => update('lineHeight', value)} />
      <Range label="段间距" value={settings.paragraphGap} min={0} max={1} step={0.04} onChange={(value) => update('paragraphGap', value)} />
      <Range label="栏间距" value={settings.columnGap} min={32} max={112} step={4} onChange={(value) => update('columnGap', value)} />
      <Range label="页边距" value={settings.pageMargin} min={32} max={120} step={4} onChange={(value) => update('pageMargin', value)} />
    </div>}
  </section>;
}

function Range({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return <label className="range"><span>{label}</span><input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} /><output>{Number.isInteger(value) ? value : value.toFixed(2)}</output></label>;
}

function intersects(rect: DOMRect, frame: DOMRect): boolean {
  return rect.right > frame.left + 1 && rect.left < frame.right - 1 && rect.bottom > frame.top + 1 && rect.top < frame.bottom - 1;
}

function firstVisibleCharacterOffset(block: HTMLElement, frame: DOMRect): number {
  const text = block.firstChild;
  if (!(text instanceof Text) || text.length === 0) return 0;
  const range = document.createRange();
  let bestOffset = 0;
  let bestLeft = Number.POSITIVE_INFINITY;
  let bestTop = Number.POSITIVE_INFINITY;
  for (let offset = 0; offset < text.length; offset += 1) {
    range.setStart(text, offset);
    range.setEnd(text, offset + 1);
    const rect = range.getBoundingClientRect();
    if (!intersects(rect, frame)) continue;
    if (rect.left < bestLeft - 1 || (Math.abs(rect.left - bestLeft) <= 1 && rect.top < bestTop)) {
      bestOffset = offset;
      bestLeft = rect.left;
      bestTop = rect.top;
    }
  }
  return bestOffset;
}

function characterRectAt(block: HTMLElement, requestedOffset: number): DOMRect | null {
  const text = block.firstChild;
  if (!(text instanceof Text) || text.length === 0) return block.getBoundingClientRect();
  const offset = Math.max(0, Math.min(text.length - 1, requestedOffset));
  const range = document.createRange();
  range.setStart(text, offset);
  range.setEnd(text, offset + 1);
  return range.getClientRects()[0] ?? block.getBoundingClientRect();
}

function readLayoutGeometry(frame: HTMLElement, article: HTMLElement): LayoutState {
  const columnsPerSpread: 1 | 2 = frame.clientWidth >= 920 ? 2 : 1;
  const computed = getComputedStyle(article);
  const columnGap = Number.parseFloat(computed.columnGap) || 0;
  const fallbackColumnWidth = (frame.clientWidth - columnGap * (columnsPerSpread - 1)) / columnsPerSpread;
  const columnWidth = Number.parseFloat(computed.columnWidth) || fallbackColumnWidth;
  const columnStep = Math.max(1, columnWidth + columnGap);

  // scrollWidth alone is unreliable while the frame is scrolled near the end
  // (some engines report ~clientWidth + scrollLeft or collapse multicol overflow).
  // Prefer the rightmost content block's layout position as the chapter extent.
  const contentBlocks = article.querySelectorAll<HTMLElement>('[data-block-id]:not([data-block-id="column-pad"])');
  const last = contentBlocks[contentBlocks.length - 1];
  let extent = Math.max(frame.scrollWidth, article.scrollWidth, frame.clientWidth);
  if (last) {
    extent = Math.max(extent, last.offsetLeft + Math.max(last.offsetWidth, 1));
    const frameRect = frame.getBoundingClientRect();
    for (const rect of last.getClientRects()) {
      // Map viewport rect back into the scrollport's content coordinates.
      extent = Math.max(extent, rect.right - frameRect.left + frame.scrollLeft);
    }
  }

  const totalColumns = Math.max(1, Math.round((extent + columnGap * 0.25) / columnStep));
  const pad = article.querySelector<HTMLElement>('.column-pad');
  const contentColumns = Math.max(1, totalColumns - (pad ? 1 : 0));
  const trailingHalf = columnsPerSpread === 2 && contentColumns % 2 === 1;
  return {
    columnsPerSpread,
    totalColumns: contentColumns,
    totalSpreads: Math.ceil(contentColumns / columnsPerSpread),
    spreadStep: columnsPerSpread * columnStep,
    columnStep,
    trailingHalf,
  };
}

function scrollLeftForSpread(spread: number, layout: LayoutState): number {
  return spread * layout.spreadStep;
}

function layoutNearlyEqual(a: LayoutState, b: LayoutState): boolean {
  return a.columnsPerSpread === b.columnsPerSpread
    && a.totalSpreads === b.totalSpreads
    && a.totalColumns === b.totalColumns
    && a.trailingHalf === b.trailingHalf
    && Math.abs(a.spreadStep - b.spreadStep) < 0.5
    && Math.abs(a.columnStep - b.columnStep) < 0.5;
}
