import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReaderApp } from '../src/ui/ReaderApp';
import type { ChapterDocument } from '../src/model';
import { fetchChapterDocument, waitForFanqieChapter } from '../src/site/fanqie';
import { loadSettings } from '../src/settings';
import { directionForKey, isEditableEventPath, READER_NAVIGATION_EVENT } from '../src/input';
import styles from '../src/ui/reader.css?inline';

export default defineContentScript({
  matches: ['https://fanqienovel.com/reader/*'],
  runAt: 'document_start',
  async main(ctx) {
    let root: Root | null = null;
    let host: HTMLElement | null = null;
    let disposed = false;
    let currentUrl = location.href;
    let generation = 0;
    const previousOverflow = document.documentElement.style.overflow;
    const sourceStates = new Map<HTMLElement, { inert: boolean; ariaHidden: string | null }>();

    const captureNavigationKey = (event: KeyboardEvent) => {
      if (document.documentElement.dataset.tomatoWideReader !== 'active') return;
      if (event.repeat) return; // OS key-repeat was eating the "real" second intentional press feel
      if (isEditableEventPath(event.composedPath())) return;
      const direction = directionForKey(event.key);
      if (!direction) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.dispatchEvent(new CustomEvent(READER_NAVIGATION_EVENT, { detail: direction }));
    };
    window.addEventListener('keydown', captureNavigationKey, true);

    const restoreSource = () => {
      sourceStates.forEach((state, element) => {
        element.inert = state.inert;
        if (state.ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', state.ariaHidden);
      });
      sourceStates.clear();
    };

    const waitForBody = async (): Promise<HTMLElement> => {
      if (document.body) return document.body;
      await new Promise<void>((resolve) => {
        if (document.body) {
          resolve();
          return;
        }
        const observer = new MutationObserver(() => {
          if (document.body) {
            observer.disconnect();
            resolve();
          }
        });
        observer.observe(document.documentElement, { childList: true });
        // Fallback if body is already mid-parse between checks.
        document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
      });
      if (!document.body) throw new Error('页面 body 尚未就绪');
      return document.body;
    };

    const coverNativePage = (keepHost: HTMLElement | null) => {
      const body = document.body;
      if (!body) return;
      [...body.children].forEach((element) => {
        if (!(element instanceof HTMLElement) || element === keepHost) return;
        if (element.id === 'tomato-wide-reader-host') return;
        if (!sourceStates.has(element)) {
          sourceStates.set(element, { inert: element.inert, ariaHidden: element.getAttribute('aria-hidden') });
        }
        element.inert = true;
        element.setAttribute('aria-hidden', 'true');
      });
      document.documentElement.style.overflow = 'hidden';
      document.documentElement.dataset.tomatoWideReader = 'active';
    };

    const createHostShell = () => {
      const nextHost = document.createElement('div');
      nextHost.id = 'tomato-wide-reader-host';
      nextHost.setAttribute('data-extension-owned', 'true');
      // Solid cover immediately so the native page never peeks through during mount/swap.
      Object.assign(nextHost.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483646',
        background: '#f6f3ed',
      });
      const shadow = nextHost.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = styles;
      const mount = document.createElement('div');
      mount.id = 'tomato-wide-reader-root';
      shadow.append(style, mount);
      return { nextHost, mount };
    };

    const unmount = () => {
      root?.unmount();
      root = null;
      host?.remove();
      host = null;
      delete document.documentElement.dataset.tomatoWideReader;
      document.documentElement.style.overflow = previousOverflow;
      restoreSource();
    };

    const ensureHostShell = async () => {
      const body = await waitForBody();
      if (host?.isConnected && root) {
        if (host.parentElement !== body) body.append(host);
        coverNativePage(host);
        return;
      }
      root?.unmount();
      root = null;
      host?.remove();
      const { nextHost, mount } = createHostShell();
      host = nextHost;
      body.append(nextHost);
      coverNativePage(nextHost);
      root = createRoot(mount);
    };

    let mountInFlight = false;
    let lastMountAttempt = 0;
    let inactiveRetries = 0;

    let lastRenderedItemId: string | null = null;
    let lastSettings: Awaited<ReturnType<typeof loadSettings>> | null = null;

    const onChapterChange = (chapter: ChapterDocument) => {
      // Soft in-reader chapter swap already painted; just track route so the poller doesn't remount.
      lastRenderedItemId = chapter.itemId;
      currentUrl = location.href;
      sessionStorage.removeItem('tomato-wide-reader:pending-chapter-nav');
      inactiveRetries = 0;
    };

    const paintReader = (chapter: ChapterDocument, settings: Awaited<ReturnType<typeof loadSettings>>) => {
      if (!root || !host) return;
      lastSettings = settings;
      root.render(
        <React.StrictMode>
          <ReaderApp
            chapter={chapter}
            initialSettings={settings}
            onExit={unmount}
            onChapterChange={onChapterChange}
          />
        </React.StrictMode>,
      );
      lastRenderedItemId = chapter.itemId;
      currentUrl = location.href;
      sessionStorage.removeItem('tomato-wide-reader:pending-chapter-nav');
      coverNativePage(host);
      inactiveRetries = 0;
    };

    const mountCurrentRoute = async () => {
      if (mountInFlight || disposed) return;
      mountInFlight = true;
      const ownGeneration = ++generation;
      lastMountAttempt = performance.now();
      try {
        // Keep / create the immersive shell first so the native page never flashes through.
        // Must wait for <body>: content script runs at document_start.
        await ensureHostShell();
        if (disposed || ownGeneration !== generation || !host || !root) return;

        const urlItemId = /\/reader\/(\d+)/.exec(location.pathname)?.[1] ?? null;

        // Soft chapter swaps already painted React state + called onChapterChange.
        // The host page DOM often still shows the *previous* chapter after replaceState.
        // Never tear down / re-extract from that stale DOM when URL already matches what we show.
        if (
          urlItemId
          && lastRenderedItemId
          && urlItemId === lastRenderedItemId
          && host.shadowRoot?.querySelector('.reader')
        ) {
          coverNativePage(host);
          inactiveRetries = 0;
          return;
        }

        const pendingRaw = sessionStorage.getItem('tomato-wide-reader:pending-chapter-nav');
        let previousItemId: string | null = null;
        let previousFingerprint: string | null = null;
        if (pendingRaw) {
          try {
            const pending = JSON.parse(pendingRaw) as {
              fromItemId?: string;
              fromFingerprint?: string;
              at?: number;
            };
            if (pending.fromItemId && typeof pending.at === 'number' && Date.now() - pending.at < 15_000) {
              previousItemId = pending.fromItemId;
              previousFingerprint = typeof pending.fromFingerprint === 'string' ? pending.fromFingerprint : null;
            } else {
              sessionStorage.removeItem('tomato-wide-reader:pending-chapter-nav');
            }
          } catch {
            sessionStorage.removeItem('tomato-wide-reader:pending-chapter-nav');
          }
        }

        // Prefer network fetch for hard URL changes when we already have a reader — native DOM
        // often lags behind location after soft history updates or SPA transitions.
        let chapter: ChapterDocument | null = null;
        if (lastRenderedItemId && urlItemId && lastRenderedItemId !== urlItemId) {
          try {
            chapter = await fetchChapterDocument(location.href);
          } catch {
            chapter = null;
          }
        }
        // Soft-nav race: URL moved but onChapterChange has not run yet. Prefer fetch over DOM.
        if (!chapter && urlItemId && host.shadowRoot?.querySelector('.reader')) {
          try {
            chapter = await fetchChapterDocument(location.href);
          } catch {
            chapter = null;
          }
        }
        if (!chapter) {
          chapter = await waitForFanqieChapter(12_000, {
            previousItemId: previousItemId && previousItemId === lastRenderedItemId ? previousItemId : null,
            previousFingerprint:
              previousFingerprint && previousItemId === lastRenderedItemId ? previousFingerprint : null,
          });
        }
        if (disposed || ownGeneration !== generation || !host || !root) return;
        const settings = lastSettings ?? await loadSettings();
        if (disposed || ownGeneration !== generation || !host || !root) return;

        // SPA navigations can rewrite body children; keep host on top and re-cover newcomers.
        await ensureHostShell();
        if (disposed || ownGeneration !== generation || !host || !root) return;

        // Same chapter re-extract (URL unchanged / still settling) — do not remount to page 1.
        if (chapter.itemId === lastRenderedItemId && host.shadowRoot?.querySelector('.reader')) {
          coverNativePage(host);
          inactiveRetries = 0;
          return;
        }

        // Never paint a document whose itemId disagrees with the address bar (stale body + new URL).
        if (urlItemId && chapter.itemId !== urlItemId) {
          try {
            chapter = await fetchChapterDocument(location.href);
          } catch {
            inactiveRetries = 0;
            return;
          }
        }

        paintReader(chapter, settings);
      } catch (error) {
        if (ownGeneration !== generation) return;
        const message = error instanceof Error ? error.message : '无法启动宽屏阅读';
        console.warn('[tomato-wide-reader]', message, error);
        // First-load failure (no chapter ever painted): fall open to native page.
        // Chapter-switch failure: keep the previous chapter on screen.
        const hasPaintedReader = Boolean(host?.shadowRoot?.querySelector('.reader'));
        if (!hasPaintedReader) {
          unmount();
          showFailOpenNotice(message);
        }
      } finally {
        mountInFlight = false;
      }
    };

    const onPopState = () => {
      // Soft back/forward: fetch by URL without tearing the shell down.
      if (disposed) return;
      currentUrl = location.href;
      inactiveRetries = 0;
      void (async () => {
        if (!host?.shadowRoot?.querySelector('.reader') || !root) {
          void mountCurrentRoute();
          return;
        }
        try {
          const chapter = await fetchChapterDocument(location.href);
          const settings = lastSettings ?? await loadSettings();
          paintReader(chapter, settings);
        } catch {
          void mountCurrentRoute();
        }
      })();
    };

    // document_start can race SPA bootstraps; a single silent failure looked like "stuck on native".
    void mountCurrentRoute();
    window.addEventListener('popstate', onPopState);
    const routeTimer = window.setInterval(() => {
      if (location.href !== currentUrl) {
        currentUrl = location.href;
        inactiveRetries = 0;
        void mountCurrentRoute();
        return;
      }
      // Retry a few times while inactive: site may finish hydrating after our first timeout.
      if (
        document.documentElement.dataset.tomatoWideReader !== 'active'
        && !disposed
        && !mountInFlight
        && inactiveRetries < 8
        && performance.now() - lastMountAttempt > 1500
      ) {
        inactiveRetries += 1;
        void mountCurrentRoute();
      }
    }, 300);

    ctx.onInvalidated(() => {
      disposed = true;
      generation += 1;
      window.clearInterval(routeTimer);
      window.removeEventListener('keydown', captureNavigationKey, true);
      window.removeEventListener('popstate', onPopState);
      unmount();
    });
  },
});

function showFailOpenNotice(message: string): void {
  document.getElementById('tomato-wide-reader-fail-notice')?.remove();
  const notice = document.createElement('button');
  notice.id = 'tomato-wide-reader-fail-notice';
  notice.type = 'button';
  notice.textContent = `宽屏阅读未启用（v0.1.17）：${message}`;
  Object.assign(notice.style, {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    zIndex: '2147483647',
    maxWidth: 'min(420px, calc(100vw - 32px))',
    padding: '10px 12px',
    border: '1px solid rgba(0,0,0,.12)',
    borderRadius: '6px',
    background: '#f6f3ed',
    color: '#292824',
    font: '13px system-ui',
    cursor: 'pointer',
    textAlign: 'left',
    boxShadow: '0 8px 24px rgba(0,0,0,.12)',
  });
  notice.title = '点击关闭；完整错误见控制台 [tomato-wide-reader]';
  notice.addEventListener('click', () => notice.remove(), { once: true });
  (document.body ?? document.documentElement).append(notice);
  setTimeout(() => notice.remove(), 30_000);
}
