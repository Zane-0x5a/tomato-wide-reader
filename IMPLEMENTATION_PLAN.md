# Tomato Wide Reader - Implementation Plan

Status: installed and functionally verified in the user's normal Edge profile; image and one-hour endurance acceptance remain open

## 1. Active brief

- Active work plane: control plane. This document controls how the object-plane extension will be built and judged.
- Current contradiction: the visible Fanqie chapter looks readable, but the DOM/accessibility text contains many Private Use Area characters rendered through a site font. A superficial DOM clone can look correct while failing system-font rendering, copy fidelity, accessibility, and semantic anchoring.
- Protected values: long-session visual comfort, lossless content, stable spatial orientation, native account progress, minimal permissions, and a readable fail-open path.
- Binding claims: the MVP is an automatic immersive one/two-column paginated reader; all release blockers in `SPEC.md` remain active until verified; publication VIP books are unsupported without an official browser content source.
- Open questions: canonical Unicode source/decoder, exact Fanqie progress semantics, final motion treatment, and thresholds for one/two-column switching and gesture debouncing.

## 2. Actual workflow simulation

The implementation must be designed against this real path, not an idealized standalone reader:

1. The user navigates to `fanqienovel.com/reader/<item-id>` while logged in or logged out.
2. Fanqie renders or hydrates the chapter, may mutate the DOM, loads a custom font, and calls its own reader/progress APIs.
3. The content script observes the supported route and waits for a bounded readiness condition.
4. A Fanqie adapter inspects the route, structured page data, DOM, computed styles, chapter navigation, images, and entitlement/error state without hiding anything yet.
5. The adapter obtains canonical Unicode content. It normalizes the chapter into a typed, source-independent document model and verifies that the normalized result agrees with observable source structure.
6. Only after validation succeeds does the extension mount an isolated reader surface and hide the original visual reader reversibly.
7. The pagination engine lays the normalized document into a fixed-height horizontal column strip. The viewport shows one column on narrow widths or one two-column spread on wide widths.
8. A saved semantic anchor is resolved after layout; otherwise the chapter begins at its first spread.
9. Edge clicks, keys, wheel, and touchpad gestures dispatch the same navigation command. The motion controller changes spread state without moving the background frame.
10. At chapter boundaries, the site adapter uses the native navigation/progress contract, with a bounded adjacent-chapter prefetch where safe.
11. Route changes, resize, browser zoom, settings changes, font readiness, and image readiness trigger a debounced reflow around the current semantic anchor.
12. Any integrity failure unmounts the extension surface, restores the original page, and shows a minimal local-only diagnostic.

Branch expansion must include long and short chapters, dialogue-heavy one-line paragraphs, images, missing images, font delays, DOM changes, rapid navigation, selection, narrow windows, reduced motion, slow networks, unavailable chapters, login changes, and unknown nearby cases that can produce the same semantic lie.

## 3. Proposed architecture

### 3.1 Toolchain

- WXT with Manifest V3 for extension entrypoints, build output, storage wrappers, and Chromium targeting.
- TypeScript in strict mode.
- React for control surfaces and reader composition.
- Framework-independent TypeScript modules for extraction, normalization, pagination math, anchors, and Fanqie contracts.
- CSS custom properties for design tokens and live typography controls.
- Vitest for pure modules and fixture-driven contracts.
- Playwright with a persistent Chromium/Edge extension context for automated extension flows.
- Real Edge verification against the authenticated site after fixture and synthetic tests pass.

WXT is a proposed default, not an irreversible dependency. Phase 0 must confirm it can inject the required isolated UI, access the needed page-world data through a narrow bridge, and produce an unpacked Edge build without broad permissions. If it cannot, retain the module boundaries and use a minimal Vite/Rollup MV3 build.

### 3.2 Runtime ownership

- `entrypoints/content`: route lifecycle, preflight orchestration, mounting, teardown, and fail-open recovery.
- `site/fanqie`: selectors, structured-data discovery, page-world bridge, chapter links, directory, progress, and entitlement states.
- `content`: typed `ChapterDocument`, Unicode normalization, source checksums, stable block IDs, and image records.
- `pagination`: measurement host, column layout, spread count, fragmentation checks, and reflow.
- `anchor`: block/character anchors, range resolution, persistence, and reflow restoration.
- `navigation`: commands, edge zones, keyboard, wheel/touchpad accumulator, locks, and chapter boundaries.
- `motion`: replaceable spread-transition strategies and reduced-motion behavior.
- `ui`: reader surface, top controls, bottom controls, directory drawer, settings, loaders, and diagnostics.
- `storage`: versioned settings and local semantic positions only.

The original Fanqie reader must be hidden, never destructively rewritten. Teardown must restore it without a page reload whenever possible.

## 4. Phase plan

### Phase 0 - Feasibility gates and evidence fixtures

Purpose: close the technical unknowns that determine whether the product can be controlled.

Work:

1. Capture sanitized structural fixtures from at least three real web-readable chapters:
   - ordinary prose;
   - dialogue/short-paragraph heavy content;
   - a chapter containing an image or atypical block if available.
2. Identify all candidate content sources: SSR state, page-world stores, `/api/reader/full`, rendered DOM, and font resources.
3. Prove a canonical Unicode path:
   - prefer an official page payload containing real Unicode;
   - otherwise document and implement a deterministic site-font decoding contract;
   - reject a solution that only looks correct with Fanqie's obfuscation font.
4. Compare normalized output against visible text, paragraph counts, punctuation, copied text, and stable hashes on multiple chapters.
5. Observe native previous/next chapter navigation, directory loading, and progress updates without mutating account state beyond ordinary reading.
6. Map supported, unavailable, logged-out, deleted, and publication-VIP states.
7. Record the minimum host permissions and whether a page-world bridge is actually required.

Exit gate:

- Three representative chapters produce readable Unicode with no unexplained block loss or reordering.
- Native chapter/progress behavior is understood well enough to define adapter contracts.
- Unsupported content fails open.
- The framework/build choice is confirmed.

If Unicode normalization cannot be made reliable, stop production UI work and report the content-source obstruction. Do not compensate with a site-font-only reader.

### Phase 1 - Approved visual and motion concept

Purpose: turn the behavioral spec into a production visual contract before coding the final UI.

Work:

1. Generate full-screen concept images for the primary 1463 x 823 logical viewport:
   - idle light two-column spread;
   - top controls and typography settings open;
   - table-of-contents drawer open;
   - dark theme;
   - narrow one-column fallback.
2. Preserve the specified continuous background, small optional `7/18`, open layout, top/bottom control model, and absence of decorative cards.
3. Extract a design system: exact palette, type scales, spacing, column geometry, controls, icon family, focus states, and motion timings.
4. Build a small isolated motion harness with real Chinese text and compare at least:
   - directional masked reveal with minimal displacement;
   - restrained crossfade plus directional edge cue;
   - instant replacement with a short boundary trace as the reduced-motion baseline.
5. Test normal, reverse, and rapid repeated turns; reject transitions that create carousel-like travel or illegible overlap.
6. Obtain user approval of the complete surface and selected motion behavior.

Exit gate:

- A complete visual concept and design-token inventory are approved.
- Motion is selected by observed reading effect, not label preference.
- The accepted concepts become fidelity references for implementation.

### Phase 2 - Extension foundation and contract harness

Purpose: establish the smallest production skeleton that can prove activation and teardown safely.

Work:

1. Scaffold WXT, React, strict TypeScript, linting, formatting, Vitest, and Playwright.
2. Create a minimal MV3 manifest limited to Fanqie reader routes and local storage.
3. Implement route detection for initial load, History API changes, back/forward navigation, and tab restoration.
4. Mount an isolated Shadow DOM reader shell without yet hiding the source.
5. Implement reversible activation, teardown, local diagnostic logging, and a development fixture page.
6. Add CI-style commands for typecheck, lint, unit tests, build, and browser tests.

Exit gate:

- The unpacked extension activates only on supported routes.
- Mount/unmount cycles leave the original page usable.
- Build and automated harness run from a clean checkout.

### Phase 3 - Fanqie adapter and fail-open extraction

Purpose: deliver a verified `ChapterDocument`, not raw DOM nodes.

Work:

1. Implement source readiness with bounded waits and mutation observation.
2. Extract title, body blocks, author notes, images, source order, current item ID, book ID, and navigation metadata.
3. Apply the Phase 0 Unicode normalization path.
4. Assign stable block IDs and character offsets for anchors.
5. Validate content with block counts, non-empty text rules, duplicate detection, ordering checks, and image metadata checks.
6. Classify known unavailable states separately from adapter failures.
7. Hide the original visual reader only after validation succeeds; restore it on any later fatal error.

Exit gate:

- Fixture and real-page transcripts demonstrate exact normalized content order.
- Obfuscated DOM text cannot leak into system-font rendering.
- Unknown structures preserve the original site rather than producing a partial reader.

### Phase 4 - Lossless pagination and semantic anchors

Purpose: make pagination correct before making it decorative.

Work:

1. Render normalized blocks into an offscreen fixed-height measurement host.
2. Use browser-native horizontal CSS column fragmentation for the primary layout, with explicit column width, gap, and fixed height.
3. Group one or two physical columns into a logical spread based on measured usable width.
4. Measure total strip width and spread boundaries after fonts and images settle.
5. Detect clipping, unexpected vertical overflow, zero-width fragments, broken images, and unstable layout loops.
6. Implement semantic anchors as stable block ID plus character offset and affinity.
7. Resolve anchors through DOM Ranges after reflow and calculate the containing spread.
8. Reflow on viewport, zoom, settings, font, and image changes while keeping the anchor stable.
9. Ensure a new chapter always begins on a new spread.

Exit gate:

- Synthetic and sanitized chapters show no lost, duplicated, reordered, or clipped content.
- Repeated wide/narrow/font/spacing changes return to the same sentence or closest valid position.
- Image fragmentation rules pass dedicated cases.

Fallback rule: if browser column fragmentation cannot meet image and anchor integrity requirements, replace only the pagination engine with an explicit measured block/Range paginator; do not weaken the content contract.

### Phase 5 - Unified navigation and motion

Purpose: make every input method drive one reliable state machine.

Work:

1. Define `previousSpread`, `nextSpread`, `previousChapter`, and `nextChapter` commands.
2. Implement dynamic edge zones that occupy margins but never article text.
3. Add keyboard commands with correct focus and editable-element exclusions.
4. Add wheel/touchpad accumulation, direction reset, velocity-aware thresholding, transition locks, and rapid-turn behavior.
5. Preserve native selection, context menu, and copy behavior.
6. Implement the approved motion strategy through a replaceable motion controller.
7. Honor `prefers-reduced-motion` and ensure focus/state changes do not wait on animation completion.

Exit gate:

- One deliberate gesture produces one spread transition.
- Rapid intended turns remain responsive without accidental skipping.
- Forward/backward direction is obvious and the stable frame does not travel.

### Phase 6 - Reading controls and design fidelity

Purpose: complete the quiet reading surface without compromising paging zones.

Work:

1. Implement approved light, dark, and system themes.
2. Implement quick font presets and advanced controls for font, line height, paragraph gap, column gap, and margins.
3. Add optional numeric-only page indicator.
4. Add hover/focus-revealed top and bottom controls with keyboard accessibility.
5. Build the searchable full-height directory drawer with current-chapter positioning and virtualization for large books.
6. Use a consistent icon system and explicit control typography.
7. Match the approved concept at primary, wider, and narrow viewports.

Exit gate:

- Controls are fully functional, accessible, and absent from the idle visual field except for the optional indicator.
- No control overlaps text or page-turn zones.
- Screenshot comparison closes all material fidelity differences.

### Phase 7 - Chapter continuity, progress, prefetch, and persistence

Purpose: make long reading sessions survive real navigation and restarts.

Work:

1. Integrate native Fanqie previous/next chapter semantics and directory navigation.
2. Preserve or reproduce only the native progress side effect proven in Phase 0.
3. Prefetch one adjacent chapter with cancellation, deduplication, bounded memory, and no bulk crawling.
4. Store versioned settings and minimal local semantic anchors.
5. Restore after refresh, tab discard, extension reload, and browser restart.
6. Handle stale anchors, edited chapters, missing blocks, and changed pagination by choosing the closest valid position.

Exit gate:

- Cross-chapter forward/backward navigation is reversible.
- Fanqie chapter progress is observed to update normally.
- Local restoration lands at the same sentence or documented nearest fallback.

### Phase 8 - Resilience, privacy, and adversarial QA

Purpose: distinguish a passing mechanism from a controlled product.

Work:

1. Test slow responses, offline transitions, failed prefetch, image timeout, font timeout, DOM mutation, SPA route races, logged-out state, missing chapter, and publication-VIP state.
2. Test selection across columns, copy fidelity, browser zoom, high DPI, reduced motion, keyboard-only use, and screen-reader semantics.
3. Confirm no stored or logged cookies, tokens,正文, or account identifiers.
4. Audit manifest permissions and remove every unproven permission.
5. Run mutation-style adapter tests against renamed wrappers, inserted promotions, and reordered non-content nodes.
6. Replay a transcript-driven reading session that intentionally stresses reverse turns, resize, settings changes, chapter edges, refresh, and recovery.

Exit gate:

- Every known fatal condition restores a readable original page.
- Unknown content is never silently truncated.
- Privacy and permission audits are clean.

### Phase 9 - Product acceptance and unpacked release

Purpose: close the MVP against the user's actual reading demand.

Work:

1. Build the unpacked Edge artifact and install it in the user's normal Edge profile.
2. Perform concept-to-render QA with screenshots and `view_image` at the primary logical viewport plus wider and narrow cases.
3. Maintain a fidelity ledger covering layout, typography, colors, controls, icons, responsive behavior, and motion.
4. Run the `SPEC.md` release-blocker matrix item by item.
5. Conduct the required one-hour continuous real reading session in the primary environment.
6. Record text-integrity, navigation, progress, restoration, failure, and comfort results.
7. Fix every release-blocking finding and repeat affected tests.
8. Produce the unpacked build, installation instructions, privacy statement draft, and known-unsupported-content note.

Exit gate:

- Every MVP blocker is verified complete, not merely implemented.
- The one-hour session passes without vertical reading scroll, content-integrity failure, progress regression, or material visual-fatigue issue.
- Publication VIP content remains explicitly identified as unsupported.

## 5. Verification layers

1. Pure unit tests: normalization, stable IDs, anchor serialization, spread math, input accumulators, storage migrations.
2. Fixture contract tests: sanitized Fanqie structures, obfuscated text cases, error states, and adapter drift.
3. Synthetic browser tests: deterministic long text, short paragraphs, images, resize, zoom, rapid gestures, selection, and reduced motion.
4. Extension browser tests: MV3 injection, Shadow DOM, route lifecycle, permissions, teardown, and persistence.
5. Real-site transcripts: extraction fidelity, native progress, chapter continuity, and fail-open behavior.
6. Visual fidelity: approved concept versus current screenshots at exact viewports.
7. Human endurance test: the required one-hour reading session.

No lower layer substitutes for a higher layer.

## 6. Delivery sequence

The practical delivery order is:

1. Unicode/content-source feasibility report and sanitized fixtures.
2. Approved visual and motion concepts.
3. Installable foundation with safe activation/teardown.
4. Lossless single-chapter paginated vertical slice.
5. Full input, controls, and responsive behavior.
6. Cross-chapter progress/persistence vertical slice.
7. Adversarial closure and one-hour acceptance.
8. Unpacked MVP artifact.

The first demonstrable build is not a release candidate. It becomes one only after Phases 0 through 9 close the coverage matrix.
