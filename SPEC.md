# Tomato Wide Reader - Product Specification

Status: installed and functionally verified in the user's normal Edge profile; one-hour comfort and representative real-image acceptance remain open

## 1. Root purpose

Build an Edge-first Chromium extension for the Fanqie Novel desktop reader that turns the site's narrow, scrolling article into a calm, full-viewport paginated reading experience.

The protected user demand is not merely "use more horizontal space." The product must reduce long-session visual fatigue while increasing useful information density. A wider single line, a cosmetic `max-width` override, or two columns that still require vertical scrolling are false completions.

Primary validation environment:

- Display: 2560 x 1440
- Windows scaling: 175%
- Edge page zoom: 100%
- Approximate logical desktop: 1463 x 823 before browser chrome

## 2. Product principles

1. Reading comes first. While idle, the viewport should contain almost nothing except the text and an optional numeric page indicator.
2. The spread is stable. Page background and reading frame should not make large movements during navigation.
3. Pagination is semantic. Reflow must not lose, duplicate, reorder, or clip content.
4. The original site remains the account and entitlement authority. The extension owns presentation, not content access.
5. Failure stays readable. If extraction or navigation is uncertain, restore the original Fanqie page.
6. Controls earn their place. App-download QR codes, promotions, reward entry points, and similar non-reading controls are removed.

The rendered Fanqie page currently exposes many body characters as Private Use Area code points and relies on a site font to display the intended Chinese glyphs. A valid implementation must obtain normalized Unicode text before applying user-selected fonts. Merely cloning obfuscated DOM text with Fanqie's font is a false completion because it leaves typography switching, copying, accessibility, and semantic anchoring uncontrolled.

## 3. Scope

### 3.1 MVP capabilities

- Automatically activate on supported Fanqie desktop reader pages whenever the Edge extension is enabled.
- Replace vertical scrolling with fixed-viewport pagination.
- Use a two-column spread on wide viewports and automatically fall back to a one-column page when usable width is insufficient.
- Preserve the current semantic text position when the viewport, zoom, column count, font, or spacing changes.
- Support forward and backward navigation by:
  - clicking the left or right viewport edge;
  - Left/Right and PageUp/PageDown keys;
  - mouse wheel;
  - touchpad gestures.
- Make edge clicking the primary pointer interaction.
- Navigate continuously across chapters without a confirmation page.
- Start every chapter on a new screen at the top of the left column.
- Prefetch only the adjacent chapter needed for continuous reading.
- Provide a searchable, full-height table-of-contents drawer with current-chapter positioning.
- Provide typography and theme settings with quick presets and expandable fine controls.
- Preserve Fanqie's account-level chapter progress behavior.
- Restore the local within-chapter position using a semantic content anchor rather than a page number.
- Preserve native text selection, copying, context menus, browser zoom, and accessibility preferences.
- Preserve legitimate inline images and paginate them without clipping.

### 3.2 Explicit non-goals for MVP

- Bookmarks, notes, highlights, annotations, or an extension-owned cloud sync system.
- Downloading or exporting books.
- Circumventing login, payment, DRM, app-only delivery, or publisher access controls.
- Simultaneous publication to multiple browser stores.
- Reproducing Fanqie's promotional, reward, or App-download controls.

## 4. Reading layout

### 4.1 Wide mode

- Treat both columns as one synchronized spread: left column, then right column, then the next spread.
- Use one continuous reading background, not two cards or simulated sheets of paper.
- Separate columns with a comfortable gutter and an optional very faint center rule.
- Keep the background and overall reading frame visually stable.
- Reserve enough outer margin for reliable click targets without placing text under them.

### 4.2 Narrow mode

- Select one or two columns from measured usable width, not from device resolution alone.
- Never preserve two columns by silently shrinking the user's font size.
- Reduce outer margins before compromising text size.
- Reflow back and forth without losing the current paragraph.

### 4.3 Default typography baseline

Initial prototype values, subject to visual reading tests:

- System sans-serif body font by default; optional installed serif/Song-style stack.
- Approximate presets: 18 px / 20 px / 22 px.
- Standard line height: about 1.65.
- First-line indent: 2 em.
- Paragraph spacing: about 0.35-0.5 em.
- Preserve source paragraphs and punctuation while avoiding an additional oversized CSS gap.
- Support fine adjustment of font size, line height, column gap, and page margins.

## 5. Navigation behavior

### 5.1 Edge click zones

- Left edge goes to the previous spread; right edge goes to the next spread.
- Click zones must not overlap selectable text.
- Clicking inside the article never turns the page.
- Opening a drawer or settings panel suspends edge navigation until it closes.

### 5.2 Wheel and touchpad

- Scrolling down advances; scrolling up goes back.
- Accumulate input to a threshold and enforce a transition lock so one gesture cannot skip multiple spreads accidentally.
- Rapid deliberate navigation may shorten or omit intermediate motion.

### 5.3 Chapter boundaries

- One further forward action from the final spread opens the next chapter.
- A backward action from the first spread returns to the previous chapter's final spread.
- Never flow two chapters into a single spread merely to fill blank space.
- Adjacent chapter prefetch must be bounded and must not bulk-fetch the book.

## 6. Control surfaces

### 6.1 Idle state

- No permanent sidebar.
- Optional bottom-center indicator contains numbers only, for example `7/18`.
- The numeric indicator can be disabled; full progress remains available in the bottom controls.

### 6.2 Top controls

- Reveal when the pointer approaches the top edge.
- Include table of contents, display settings, theme, and essential status/exit affordances.
- Do not use the right edge as a full-height reveal target because it conflicts with primary page turning.

### 6.3 Bottom controls

- Reveal when the pointer approaches the bottom edge.
- Include previous chapter, detailed chapter/page progress, and next chapter.

### 6.4 Table of contents

- Open from the top controls as a full-height drawer.
- Highlight and scroll to the current chapter.
- Support title search and large chapter lists.
- Close after navigation, on Escape, or when the user clicks outside.

### 6.5 Settings

- Expose fast font-size presets and theme choices first.
- Put detailed typography and spacing controls behind an expanded section.
- Store settings locally.
- Themes: Light, Dark, and Follow System; Follow System is the default.
- Avoid pure white and pure black reading backgrounds.

## 7. Motion specification

Motion is required, but the final transition is intentionally not selected without prototypes.

Protected effect:

- restrained digital feedback, not a physical paper simulation;
- both columns update as one spread;
- direction is immediately understandable;
- the background and frame remain stable;
- outgoing and incoming text do not overlap illegibly;
- reduced-motion preference disables or simplifies the transition.

Leading prototype direction: a directional masked reveal with a small positional cue and subtle boundary/shadow change. Whole-viewport carousel motion, independent column motion, and exaggerated 3D page curls are not accepted without evidence that they reduce rather than increase tracking effort.

Motion remains `partial` until compared with real Chinese long-form text under repeated and rapid page-turn scenarios.

## 8. Content contract

- Render the chapter title, body, author notes that are genuinely part of the chapter, and legitimate inline images.
- Preserve paragraph order, punctuation, and content.
- Remove App QR codes, downloads, promotions, reward controls, recommendations, and comment prompts from immersive reading.
- Retain meaningful loading, missing-chapter, deletion, and entitlement messages.
- Do not merge or rewrite source text to improve density.

Image rules:

- Small images stay within one column.
- Large images should begin near a column boundary where practical.
- An image too tall for the text area may receive a dedicated centered spread.
- Never crop an image at a column or spread boundary.
- A failed image shows a bounded placeholder and alternative text without blocking the chapter.

## 9. Progress and persistence

- Keep Fanqie's native chapter navigation/progress mechanism functioning so other devices can resume at least at chapter granularity.
- Store only the minimum local data needed for extension settings and the within-chapter semantic anchor.
- Recompute page numbers after every reflow; never treat a saved page number as a stable position.
- The anchor must survive refresh and normal layout changes.

## 10. Activation and compatibility

- Edge extension enabled: supported reader pages are automatically replaced by immersive mode.
- Edge extension disabled: Fanqie behaves normally.
- Do not add a redundant in-product master switch.
- Edge is the release and acceptance target; implementation should remain compatible with Chromium Manifest V3 without Edge-private APIs.

## 11. Failure, privacy, and permissions

- Validate required page structure before hiding or replacing the original reader.
- If extraction, content integrity, or chapter navigation cannot be confirmed, leave or restore the original page and show a small dismissible diagnostic message.
- Never leave the user with a blank reader.
- Request host access only for the Fanqie pages and APIs needed by the reader.
- Do not upload reading content, account data, or diagnostics.
- Diagnostics must avoid tokens, cookies,正文, and personally identifying account details.

## 12. Publication VIP finding

`倦怠社会` was tested on 2026-07-23 using the user's authenticated Edge session.

Evidence:

- Book ID: `7132026379926768648`.
- The bookshelf exposed metadata, `vip_book = 1`, `serial_count = 11`, chapter identifiers, and short abstracts.
- The book card was explicitly marked disabled for browser reading.
- The standard reader URL for item `7132034374811257890` returned HTTP 404 and displayed zero words / no content.
- The official web endpoint `/api/reader/full?itemId=7132034374811257890` returned HTTP 200 but application result `code = -1`, empty `data`, and `没有对应章节`.

Conclusion: the browser receives metadata and abstracts but not full chapter text. This is not recoverable by removing a modal or changing CSS. Publication VIP support is an unresolved separate product line and is not an MVP blocker. The extension must not claim support for these books.

## 13. Release-blocker coverage matrix

| Capability | Specification | Implementation | Release status |
| --- | --- | --- | --- |
| Semantic body extraction | Complete | Implemented; fixture contracts and normal-profile public-page replay | Verified complete for observed web-readable chapters |
| Unicode content normalization | Complete for observed site font subset | 362/362 glyph map plus unknown-glyph rejection | Verified complete for observed subset |
| Lossless two-column pagination | Complete | Implemented with measured CSS column geometry | Verified on multi-spread Edge fixture |
| Responsive one/two-column reflow | Complete | Implemented without font-size reduction | Verified on 1463x823 and 768x1024 fixtures |
| Edge/keyboard/wheel/touchpad navigation | Complete | Unified state machine and gesture threshold | Verified for edge, keyboard, and wheel fixture flows |
| Restrained page-turn motion | Complete implementation contract | 150ms directional clipped reveal; reduced-motion path | Partial: one-hour comfort review open |
| Cross-chapter navigation and prefetch | Complete | Native control delegation plus one-document prefetch | Verified complete on real chapters 488/489 |
| Typography and themes | Complete | Presets, advanced controls, local storage, light/dark/system | Verified on Edge fixture |
| Table of contents | Complete | Searchable full-height drawer plus official directory endpoint fallback | Verified complete with 952-chapter real directory |
| Native progress compatibility | Complete | Original runtime retained and native controls clicked | Verified complete: application code 0 progress responses |
| Semantic within-chapter restore | Complete | Stable block ID plus character offset and Range resolution | Verified across wide/narrow fixture reflow |
| Image pagination | Complete | Bounded image rendering and break avoidance | Partial: representative real image chapter open |
| Fail-open fallback | Complete | Original DOM retained and restored; local-only notice | Verified for unknown glyph and structural failures |
| Privacy and minimal permissions | Complete | `storage` plus exact reader host only; zero production audit findings | Verified complete |
| Publication VIP books | Feasibility tested; no browser content source | Not supported | Explicit non-support |

No capability in the matrix may be called complete because a mechanism exists. Completion requires product behavior under real and adversarial reading flows.

## 14. MVP acceptance

The first version is usable only after a real continuous reading session of at least one hour in the primary validation environment, with all of the following true:

- no vertical reading scroll is required;
- no text is lost, duplicated, clipped, or reordered;
- page turns, rapid turns, backward turns, and chapter boundaries remain correct;
- reflow and refresh return to the same semantic reading position;
- edge clicks do not interfere with selection and copying;
- directory, themes, typography, and responsive column switching work;
- Fanqie chapter progress continues to update;
- slow networks, failed prefetches, missing images, changed DOM, and unavailable chapters fail safely;
- motion does not cause obvious tracking strain and respects reduced motion.

Validation must include sad paths and a transcript-style replay of an actual reading session. Unit tests and a happy-path demo do not close the release scope by themselves.

## 15. Real Edge acceptance evidence

Date: 2026-07-24. The unpacked extension was installed and enabled in the user's normal Edge profile through the browser's extension manager. The authenticated Fanqie session was reused; no login, cookies, tokens, or account identifiers were requested from or exposed to the user.

Observed on public web-readable chapters 488 and 489:

- Automatic Shadow DOM mount, decoded Unicode text, fixed viewport, two-column spread, and `scrollY = 0`.
- One `ArrowRight` at the final spread advanced exactly once to the next chapter; it did not also trigger Fanqie's shortcut.
- One `ArrowLeft` at the first spread returned to the previous chapter's final spread (`7/7`), with the open-at-end marker consumed.
- Edge click, keyboard, and wheel navigation each advanced one spread; native progress requests returned HTTP 200 and application `code = 0` (`上传阅读进度成功`).
- Official directory endpoint returned 952 chapters. The drawer opened centered on the current chapter and search for `第900章` returned `第900章 校长的感谢`.
- Rapid typography/theme/page-indicator changes preserved the same semantic anchor and restored the default settings after the replay.

The Fanqie session also displayed its own account-security notice about another login. Dismissing that site notice did not prevent ordinary web-readable chapter delivery or the verified native progress update. Publication VIP books remain explicitly unsupported because their browser API returns no chapter body.

Remaining acceptance blockers are the required one-hour human comfort session and a representative real chapter containing inline images. These are not claimed complete by the browser evidence above.

## 16. First milestone

Deliver an unpacked Edge extension tested against real Fanqie reader pages. Engineer it to store-ready standards, but defer store listing assets and multi-store publication until the reading experience passes the MVP acceptance criteria.
