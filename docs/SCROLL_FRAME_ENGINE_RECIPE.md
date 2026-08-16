# Scroll-Driven Frame Sequence Engine

A practical handoff for reproducing the smooth CHBERRY scroll-video behavior in another project.

---

## 1. The exact problem this solves

A normal implementation often looks like this:

```text
page scroll position → progress → video.currentTime
```

That sounds correct, but in practice MP4 seeking is not guaranteed to display the requested image immediately. The browser may need to:

- find a nearby keyframe,
- decode forward to the requested time,
- wait for more data,
- discard older seek requests when the wheel moves quickly.

The visible result is:

```text
user scrolls
nothing visibly changes
browser catches up
video jumps in a chunk
```

Adding more smoothing makes this worse because it inserts more delay between the user's hand and the displayed image.

The final solution avoids seeking inside an MP4 entirely. It converts the videos into image sequences and renders the requested images on a `<canvas>`.

---

## 2. The final mental model

Treat all scenes as one long strip of numbered images.

For the current project:

```text
Scene 1: global frames   0–119
Scene 2: global frames 120–239
Scene 3: global frames 240–359
Scene 4: global frames 360–479
```

The engine keeps two global values:

```js
currentGlobalFrame
 targetGlobalFrame
```

Input changes `targetGlobalFrame`.

The renderer moves `currentGlobalFrame` toward it one frame at a time:

```text
20 → 21 → 22 → 23
```

It never jumps straight from 20 to 23.

This is the core behavior that makes the interaction feel like the user's wheel is physically driving the video.

---

## 3. Project structure

```text
berrysite/
├── 1.mp4
├── 2.mp4
├── 3.mp4
├── 4.mp4
├── index.html
├── styles.css
├── script.js
├── extract_scroll_frames.py
├── frames-manifest.json
├── frames/
│   ├── 1/
│   │   ├── 0000.jpg
│   │   ├── 0001.jpg
│   │   └── ...
│   ├── 2/
│   ├── 3/
│   └── 4/
└── docs/
    └── SCROLL_FRAME_ENGINE_RECIPE.md
```

The `*-scroll.mp4` files and `make_scroll_videos.py` are from an earlier experiment. They are not part of the final production path.

---

## 4. Preparing the videos

### Environment

The frame extraction script uses `imageio-ffmpeg`, which supplies an ffmpeg binary.

On Windows from the project folder:

```powershell
uv venv .venv
uv pip install --python .venv\Scripts\python.exe imageio-ffmpeg
.venv\Scripts\python.exe extract_scroll_frames.py
```

The script currently extracts each source video using:

```text
24 fps
1280 px width
JPEG quality setting 4
zero-based filenames
```

Equivalent ffmpeg logic:

```text
-vf fps=24,scale=1280:-2:flags=lanczos
-q:v 4
-start_number 0
```

For a five-second clip, 24 fps creates 120 images.

### Why these settings

- **24 fps** gives enough temporal detail for wheel-driven motion without producing excessive memory use.
- **1280 px width** is a good desktop compromise. The canvas can scale it to the viewport.
- **JPEG** decodes quickly and is much smaller than PNG for cinematic footage.
- **Four-digit zero-padded names** make paths deterministic: `0000.jpg`, `0001.jpg`, and so on.

### Output manifest

The script generates `frames-manifest.json`:

```json
{
  "1": {
    "count": 120,
    "fps": 24,
    "width": 1280,
    "pattern": "./frames/1/{frame}.jpg"
  }
}
```

The runtime must use the manifest instead of hard-coding frame counts.

---

## 5. HTML structure

Each scene contains one canvas:

```html
<section class="story-section" data-index="0">
  <div class="sticky-frame">
    <canvas
      class="story-canvas"
      data-sequence="1"
      aria-label="Scene description"
    ></canvas>

    <div class="media-shade"></div>
    <div class="chapter-copy">...</div>
    <div class="section-progress"><span></span></div>
  </div>
</section>
```

The important field is:

```html
data-sequence="1"
```

That value maps to:

```text
frames/1/0000.jpg
frames/1/0001.jpg
...
```

Do not place a video element behind the canvas. The canvas is the actual runtime visual.

---

## 6. CSS architecture

The webpage does not physically scroll.

Required baseline:

```css
html,
body {
  width: 100%;
  height: 100%;
  overflow: hidden;
  overscroll-behavior: none;
  scroll-behavior: auto;
}
```

The shell and main element are fixed:

```css
.site-shell,
main {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
```

Every scene is a full-screen layer:

```css
.story-section {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
}

.story-section.is-active {
  visibility: visible;
  opacity: 1;
  pointer-events: auto;
}
```

This is important. Do not create a tall page and then try to synchronize it with the frame engine. The frame timeline is the source of truth, not `window.scrollY`.

---

## 7. Runtime state

Each sequence stores:

```js
{
  index,
  sequenceNumber,
  frameCount,
  canvas,
  context,
  progressBar,
  frames,
  currentFrame,
  targetFrame,
  ready,
  loading
}
```

Global state:

```js
const sequences = [];
const sequenceOffsets = [];

let currentGlobalFrame = 0;
let targetGlobalFrame = 0;
let totalGlobalFrames = 0;
let activeIndex = -1;
let animationRunning = false;
let ready = false;
```

### Sequence offsets

When setting up the sequences, accumulate their starting frame:

```text
sequenceOffsets[0] = 0
sequenceOffsets[1] = 120
sequenceOffsets[2] = 240
sequenceOffsets[3] = 360
```

This allows one global frame number to select both the scene and the local frame.

---

## 8. Loading and decoding frames

Load each JPEG using `fetch`, then decode it once with `createImageBitmap`:

```js
async function loadBitmap(path) {
  const response = await fetch(path, { cache: 'force-cache' });
  const blob = await response.blob();
  return createImageBitmap(blob);
}
```

Why `createImageBitmap`:

- Decoding happens before the render loop needs the frame.
- The canvas can draw the bitmap directly.
- Repeated scrolling does not repeatedly decode the same JPEG.

Use a small worker pool rather than launching every frame request at once:

```js
const workers = Math.min(8, state.frameCount);
```

Eight workers was stable for this project.

Too many simultaneous image decodes can freeze the browser and make the interaction look disconnected again.

---

## 9. Startup loading strategy

Only sequence 1 blocks the loading screen.

Current startup flow:

```text
load manifest
create sequence states
fully preload scene 1
hide loader
accept wheel input
```

Do not preload all four scenes before opening the site. Decoding hundreds of full-size frames at once can cause a large memory and CPU spike.

While the user progresses through a scene, preload the next sequence after roughly 35%:

```js
if (localProgress > 0.35 && index < sequences.length - 1) {
  loadSequence(index + 1);
}
```

Keep the active and previous scenes in memory. Release distant sequences with:

```js
bitmap.close()
```

This reduces memory use.

---

## 10. Drawing a frame correctly

The canvas backing resolution must be real pixels, not only CSS pixels.

Current limit:

```js
const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.35);
const renderWidth = Math.min(
  Math.round(viewportWidth * pixelRatio),
  1600
);
```

The 1.35 pixel ratio and 1600 px cap prevent an excessive canvas memory footprint.

Use cover-style drawing:

```js
const scale = Math.max(
  canvasWidth / bitmap.width,
  canvasHeight / bitmap.height
);
```

Then center the image:

```js
const x = (canvasWidth - drawWidth) / 2;
const y = (canvasHeight - drawHeight) / 2;
context.drawImage(bitmap, x, y, drawWidth, drawHeight);
```

---

## 11. Direct input-to-frame mapping

Current tuning values in `script.js`:

```js
const FRAMES_PER_PIXEL = 0.03;
const MAX_FRAME_BACKLOG = 10;
const KEYBOARD_FRAMES = 5;
const TOUCH_FRAMES_PER_PIXEL = 0.08;
```

### Wheel normalization

Wheel events can report pixels, lines, or pages. Normalize them:

```js
function normalizedWheelDelta(event) {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * window.innerHeight;
  return event.deltaY;
}
```

Then map pixels to frame intent:

```js
const frameDelta = normalizedWheelDelta(event) * FRAMES_PER_PIXEL;
addFrameIntent(frameDelta);
```

Capture the event before page elements can intercept it:

```js
document.addEventListener('wheel', onWheel, {
  passive: false,
  capture: true
});
```

Call `event.preventDefault()` so the document does not move.

---

## 12. Why a target frame is still used

A wheel event can request several frames at once. Drawing only the final requested frame would recreate the jump.

Therefore the engine separates:

```text
where the user wants to be: targetGlobalFrame
what is visible now:        currentGlobalFrame
```

The target is bounded around the current image:

```js
const minimumTarget = currentGlobalFrame - MAX_FRAME_BACKLOG;
const maximumTarget = currentGlobalFrame + MAX_FRAME_BACKLOG;
```

This prevents large wheel bursts from building a long queue.

With `MAX_FRAME_BACKLOG = 10`, the renderer can continue for at most about ten display frames after input stops. At 60 Hz that is roughly 167 ms in the worst case, rather than several seconds.

---

## 13. The critical frame-by-frame loop

The renderer advances by exactly one frame:

```js
function advanceOneFrame() {
  const difference = targetGlobalFrame - currentGlobalFrame;

  if (Math.abs(difference) < 0.5) {
    currentGlobalFrame = Math.round(targetGlobalFrame);
    renderGlobalFrame(currentGlobalFrame);
    return false;
  }

  currentGlobalFrame += difference > 0 ? 1 : -1;
  renderGlobalFrame(currentGlobalFrame);
  return true;
}
```

The first frame is rendered immediately when the input arrives:

```js
function ensureAnimation() {
  if (animationRunning) return;
  animationRunning = true;

  const moved = advanceOneFrame();
  if (moved) requestAnimationFrame(animationStep);
  else animationRunning = false;
}
```

This immediate call is essential. Starting only with `requestAnimationFrame()` adds one avoidable frame of input latency.

Subsequent intermediate frames are rendered using `requestAnimationFrame`:

```js
function animationStep() {
  const moved = advanceOneFrame();

  if (moved) requestAnimationFrame(animationStep);
  else animationRunning = false;
}
```

### Golden invariant

Never change the loop to this:

```js
currentGlobalFrame = targetGlobalFrame;
```

That skips intermediate frames and restores chunking.

---

## 14. Mapping global frames to scenes

Given a global frame, search the offsets backward:

```js
function locateGlobalFrame(globalFrame) {
  for (let index = sequences.length - 1; index >= 0; index -= 1) {
    const offset = sequenceOffsets[index];

    if (globalFrame >= offset) {
      return {
        index,
        localFrame: globalFrame - offset
      };
    }
  }
}
```

Then:

- activate the corresponding full-screen section,
- draw the local canvas frame,
- update the per-scene progress bar,
- update the overall journey progress,
- preload the next scene when appropriate.

---

## 15. Touch and keyboard support

Touch movement maps finger distance to frame intent:

```js
const pixelDelta = previousY - currentY;
addFrameIntent(pixelDelta * TOUCH_FRAMES_PER_PIXEL);
```

Keyboard controls:

```text
Arrow Down / Page Down / Space / Arrow Right → forward
Arrow Up / Page Up / Arrow Left              → backward
Home                                          → first frame
End                                           → final frame
```

The navigation dots can jump directly to each sequence offset.

Direct jumps are acceptable for explicit navigation. Wheel and touch interaction must preserve intermediate frames.

---

## 16. What failed before and why

### Attempt A: GSAP ScrollTrigger + `video.currentTime`

Failure:

- MP4 seeks were asynchronous.
- Frames depended on keyframe structure and decoding.
- Multiple seeks were collapsed.
- The video moved after the scroll instead of with it.

### Attempt B: increasing GSAP scrub

Failure:

- It made the delayed response feel softer but more disconnected.
- It treated lag as a styling problem rather than a decoding problem.

### Attempt C: all-I-frame MP4

The videos were re-encoded with every frame as a keyframe.

Failure:

- Seeking improved but was still controlled by the media pipeline.
- Browser decode and presentation timing could still lag.

This experiment produced `1-scroll.mp4` through `4-scroll.mp4`, but those are no longer used.

### Attempt D: canvas frames driven by native document scroll

Failure:

- Wheel input still moved the document in chunks.
- Scroll position and frame selection remained indirect.
- Custom smooth scrolling plus CSS smooth scrolling introduced double smoothing.

### Final approach: virtual frame timeline

Success factors:

- no MP4 seek,
- no native scroll position,
- no ScrollTrigger frame selection,
- input updates frame intent directly,
- intermediate frames are rendered sequentially,
- target backlog is capped.

---

## 17. Tuning guide

### Movement feels too slow

Increase:

```js
FRAMES_PER_PIXEL
```

Try small changes:

```text
0.03 → 0.035 → 0.04
```

Do not increase `MAX_FRAME_BACKLOG` merely to make it faster. That creates delayed continuation.

### Movement continues too long after scrolling stops

Reduce:

```js
MAX_FRAME_BACKLOG
```

Suggested range:

```text
6–12
```

### Movement feels too jumpy

First verify every intermediate frame is being rendered.

Then reduce:

```js
FRAMES_PER_PIXEL
```

Do not add CSS smooth scrolling or a `window.scrollTo` interpolation loop.

### Browser freezes during loading

- Load only sequence 1 before opening the site.
- Reduce worker count from 8 to 4–6.
- Reduce extraction width from 1280 to 1024.
- Keep the canvas resolution cap.
- Release distant ImageBitmaps.

### Image looks soft

Increase frame extraction width carefully:

```text
1280 → 1440
```

Then monitor memory. Do not immediately jump to 4K frames.

---

## 18. Acceptance tests

Any AI modifying this engine must pass all of these.

### Input coupling

- A small wheel movement changes the visible image immediately.
- The first image change starts in the same input path, not after a delayed scroll animation.
- Scrolling backward reverses the images immediately.

### Sequential rendering

- A request from frame 20 to frame 25 visibly passes through 21, 22, 23, and 24.
- No wheel interaction assigns `currentGlobalFrame = targetGlobalFrame`.

### Stop behavior

- When input stops, movement stops quickly.
- The remaining motion never exceeds `MAX_FRAME_BACKLOG` frames.

### Page behavior

- `window.scrollY` remains zero.
- No native scrollbar controls the experience.
- No `scroll-behavior: smooth` is active.

### Scene transitions

- Scene 1 finishes before scene 2 becomes active.
- Global progress and local progress remain correct.
- Backward travel crosses scene boundaries correctly.

### Loading

- Scene 1 is ready before the loading overlay disappears.
- Scene 2 is not required to complete startup.
- The next scene begins preloading before the current scene ends.
- No missing-frame requests appear in the network log.

### Errors

- No page errors.
- No unhandled promise rejections.
- No canvas exceptions after resize.

---

## 19. Running locally

From `D:\ChatGPT_Workspace\berrysite`:

```powershell
python -m http.server 4177 --bind 127.0.0.1
```

Open:

```text
http://localhost:4177
```

A web server is required. Opening `index.html` directly with `file://` will break `fetch()` calls for the manifest and frames.

### MCP process note

When the server is started using an MCP managed process, it may exit when the tool's configured process timeout expires. If the site later says “cannot be reached” while the files are unchanged, inspect the process first. It does not automatically mean the webpage broke.

For a persistent local workflow, run the command in a normal terminal or use a persistent dev-server process manager.

---

## 20. Adding or replacing scenes

1. Place source files in the root using sequential names such as `1.mp4`, `2.mp4`, and so on.
2. Update the extraction loop range in `extract_scroll_frames.py` if the scene count changes.
3. Run the extraction script.
4. Add or remove matching `<section>` elements in `index.html`.
5. Give each canvas the correct `data-sequence` value.
6. Add or remove navigation dots.
7. Do not manually edit frame counts in JavaScript. They come from the manifest.
8. Test forward and backward transitions at every sequence boundary.

---

## 21. Minimal recipe for another project

A new AI can reproduce the mechanism using this checklist:

1. Convert every video into sequential JPEG frames.
2. Generate a manifest containing each sequence's frame count.
3. Create one canvas per full-screen scene.
4. Disable native page scrolling.
5. Concatenate all sequence frame counts into one global frame timeline.
6. Preload and decode the first sequence with `createImageBitmap`.
7. Capture wheel input with `passive: false` and `capture: true`.
8. Convert wheel delta directly into a bounded target frame.
9. Move the visible frame toward the target one frame per animation frame.
10. Render the first movement immediately inside the input path.
11. Cap backlog so input and visuals never drift far apart.
12. Preload the next sequence during the current scene.
13. Release distant decoded frames to control memory.
14. Never use MP4 time seeking for the scroll-controlled visual.

---

## 22. AI continuation prompt

Use this when handing the project to another AI:

```text
Continue the CHBERRY scroll-frame project in D:\ChatGPT_Workspace\berrysite.

First read:
- HANDOFF.md
- docs/SCROLL_FRAME_ENGINE_RECIPE.md
- script.js
- extract_scroll_frames.py
- frames-manifest.json

The core interaction is a virtual global frame timeline rendered to Canvas. Native page scrolling, MP4 currentTime seeking, GSAP scrub, and ScrollTrigger frame selection are intentionally not used.

Preserve these invariants:
1. Wheel/touch input directly changes target frame intent.
2. The first frame advances immediately.
3. Every intermediate frame is rendered in sequence.
4. Backlog remains bounded.
5. window.scrollY remains zero.
6. Only the first scene blocks startup; later scenes preload progressively.

Before claiming success, run the acceptance tests in docs/SCROLL_FRAME_ENGINE_RECIPE.md.
```

---

## 23. Current production parameters

As of the current handoff:

```text
Source scenes:             4
Frames per scene:          120
Total global frames:       480
Extraction FPS:            24
Extracted image width:     1280 px
JPEG ffmpeg quality:       4
Frame loader workers:      8
FRAMES_PER_PIXEL:          0.03
MAX_FRAME_BACKLOG:         10
KEYBOARD_FRAMES:           5
TOUCH_FRAMES_PER_PIXEL:    0.08
Canvas DPR cap:            1.35
Canvas width cap:          1600 px
Next-scene preload point:  35%
Preview port:              4177
```

These values are a stable baseline. Change one parameter at a time and retest input coupling, stop behavior, memory use, and scene transitions.
