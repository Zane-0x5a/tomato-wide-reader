# Tomato Wide Reader Design System

The generated concepts in `output/imagegen/` are compositional references, not pixel specifications. Implementation corrects their over-large text and protects spatial position when overlays open.

## Reading Surface

- Light background: `#f6f3ed`; body text: `#292824`; muted text: `#716e67`.
- Dark background: `#1d1d1b`; body text: `#c9c6bf`; muted text: `#85827b`.
- Accent: `#a94b3b`; use for selection and progress, never as a large field.
- Default body: 18px, 1.58 line height, 2em indent, 0.32em paragraph gap.
- Wide margins: clamp 56-92px. Center gutter: 64px. A divider may use 6% text opacity.
- Two columns require at least 920px of usable reading width. Narrow mode keeps the user's font size and reduces margins first.

## Controls

- Idle surface contains only text and optional numeric `current/total` progress.
- Top and bottom controls reveal within a 28px edge sensor and on keyboard focus.
- Overlays never alter article width, page count, or semantic position.
- Drawer width: min(360px, 88vw). Panels use 6px radii, 1px borders, and restrained shadows.
- Familiar commands use Lucide icons with accessible labels and tooltips.

## Motion

- A page turn changes the scroll position immediately, then runs a 150ms directional clipped reveal plus an 8px text cue.
- The fixed background, gutter, controls, and page indicator do not move.
- Reverse direction mirrors the cue. Rapid turns skip the cue while preserving state.
- Reduced motion uses an immediate replacement with a 90ms edge trace only.

## Generated References

- `output/imagegen/idle-light.png`
- `output/imagegen/controls-settings.png`
- `output/imagegen/directory-drawer.png`
- `output/imagegen/idle-dark.png`
- `output/imagegen/narrow-single-column.png`

The attempted v2 generation is not a reference because the configured API listed `gpt-image-2` but had no available upstream channel.
