# CHBERRY Scroll-Frame Engine — Handoff

## Read this first

The scroll experience in this project is **not a normal scrolling webpage and not MP4 seeking**.

The working solution is a custom, input-driven frame-sequence engine:

```text
wheel / touch / keyboard input
        ↓
frame intent
        ↓
bounded target frame
        ↓
one intermediate frame rendered per requestAnimationFrame
        ↓
Canvas output
```

This is the source of truth for continuing the project:

- Detailed implementation recipe: [`docs/SCROLL_FRAME_ENGINE_RECIPE.md`](./docs/SCROLL_FRAME_ENGINE_RECIPE.md)
- Runtime engine: [`script.js`](./script.js)
- Frame extraction tool: [`extract_scroll_frames.py`](./extract_scroll_frames.py)
- Frame metadata: [`frames-manifest.json`](./frames-manifest.json)
- UI structure: [`index.html`](./index.html)
- Full-screen layer styling: [`styles.css`](./styles.css)

## Current result

- Four source videos: `1.mp4`, `2.mp4`, `3.mp4`, `4.mp4`.
- Each video is extracted into 120 JPEG frames at 24 fps and 1280 px width.
- All four scenes form one continuous global timeline of 480 frames.
- Native document scrolling is disabled.
- Scroll input changes the target frame directly.
- The renderer walks through every intermediate frame instead of jumping.
- The first visual frame advances immediately inside the input event path.
- Backlog is capped so the animation cannot continue for a long time after the user stops scrolling.
- Only the first sequence blocks startup; later sequences preload while the user is still inside the current scene.

## Critical rule

Do **not** replace this with any of the following:

- `video.currentTime = ...` on scroll.
- GSAP `scrub` controlling MP4 time.
- Native `scroll-behavior: smooth`.
- A custom smooth-scroll loop based on repeated `window.scrollTo()`.
- ScrollTrigger as the frame selector.
- Mapping one wheel tick directly to one distant frame and skipping intermediate frames.

Those approaches caused the exact failure this engine was built to remove: the user scrolls, waits, and then sees movement in chunks.

## Local preview

From this directory:

```powershell
python -m http.server 4177 --bind 127.0.0.1
```

Open:

```text
http://localhost:4177
```

When started through an MCP-managed process, the server may later stop because the MCP process reaches its execution timeout. That is a process-lifetime issue, not a webpage bug.

## Before changing the engine

Read the full recipe and preserve these invariants:

1. One global frame timeline.
2. No native page movement.
3. Input directly modifies frame intent.
4. First frame moves immediately.
5. Intermediate frames are rendered in order.
6. Backlog remains bounded.
7. Canvas is the visual output.
8. Preloading must not freeze user input.
