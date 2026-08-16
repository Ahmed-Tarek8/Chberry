const sections = Array.from(document.querySelectorAll('.story-section'));
const chapterCounter = document.getElementById('activeChapter');
const journeyFill = document.getElementById('journeyFill');
const journeyDots = Array.from(document.querySelectorAll('.journey-dot'));
const scrollCue = document.querySelector('.scroll-cue');
const replayButton = document.getElementById('replayButton');
const sequenceLoader = document.getElementById('sequenceLoader');
const loaderPercent = document.getElementById('loaderPercent');
const loaderBar = document.getElementById('loaderBar');

const FRAMES_PER_PIXEL = 0.03;
const MAX_FRAME_BACKLOG = 10;
const KEYBOARD_FRAMES = 5;
const TOUCH_FRAMES_PER_PIXEL = 0.08;

const sequences = [];
const sequenceOffsets = [];

let currentGlobalFrame = 0;
let targetGlobalFrame = 0;
let totalGlobalFrames = 0;
let activeIndex = -1;
let animationRunning = false;
let ready = false;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function framePath(sequenceNumber, frame) {
  return `./frames/${sequenceNumber}/${String(frame).padStart(4, '0')}.jpg`;
}

async function loadBitmap(path) {
  const response = await fetch(path, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return createImageBitmap(await response.blob());
}

async function loadSequence(index, onProgress) {
  const state = sequences[index];
  if (!state) return null;
  if (state.ready) return state;
  if (state.loading) return state.loading;

  state.loading = (async () => {
    let cursor = 0;
    let loaded = 0;
    const workers = Math.min(8, state.frameCount);

    async function worker() {
      while (cursor < state.frameCount) {
        const frame = cursor++;
        state.frames[frame] = await loadBitmap(framePath(state.sequenceNumber, frame));
        loaded += 1;
        onProgress?.(loaded, state.frameCount);

        if (frame === 0 || frame === state.targetFrame) {
          drawRequestedFrame(state);
        }
      }
    }

    await Promise.all(Array.from({ length: workers }, worker));
    state.ready = true;
    state.loading = null;
    drawRequestedFrame(state);
    return state;
  })().catch((error) => {
    state.loading = null;
    throw error;
  });

  return state.loading;
}

function releaseSequence(index) {
  const state = sequences[index];
  if (!state || !state.ready) return;

  state.frames.forEach((bitmap) => bitmap?.close?.());
  state.frames = new Array(state.frameCount);
  state.currentFrame = -1;
  state.ready = false;
}

function resizeCanvas(state) {
  const viewportWidth = Math.max(window.innerWidth, 1);
  const viewportHeight = Math.max(window.innerHeight, 1);
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.35);
  const renderWidth = Math.min(Math.round(viewportWidth * pixelRatio), 1600);
  const renderHeight = Math.round(renderWidth * viewportHeight / viewportWidth);

  if (state.canvas.width !== renderWidth || state.canvas.height !== renderHeight) {
    state.canvas.width = renderWidth;
    state.canvas.height = renderHeight;
    state.currentFrame = -1;
  }
}

function paintFrame(state, bitmap, frame) {
  if (!bitmap) return;

  resizeCanvas(state);

  const canvasWidth = state.canvas.width;
  const canvasHeight = state.canvas.height;
  const scale = Math.max(canvasWidth / bitmap.width, canvasHeight / bitmap.height);
  const drawWidth = bitmap.width * scale;
  const drawHeight = bitmap.height * scale;
  const x = (canvasWidth - drawWidth) / 2;
  const y = (canvasHeight - drawHeight) / 2;

  state.context.clearRect(0, 0, canvasWidth, canvasHeight);
  state.context.drawImage(bitmap, x, y, drawWidth, drawHeight);
  state.currentFrame = frame;
}

function nearestLoadedFrame(state, desiredFrame) {
  if (state.frames[desiredFrame]) return desiredFrame;

  for (let distance = 1; distance < state.frameCount; distance += 1) {
    const lower = desiredFrame - distance;
    const upper = desiredFrame + distance;

    if (lower >= 0 && state.frames[lower]) return lower;
    if (upper < state.frameCount && state.frames[upper]) return upper;
  }

  return -1;
}

function drawRequestedFrame(state) {
  const frame = nearestLoadedFrame(state, state.targetFrame);
  if (frame >= 0 && frame !== state.currentFrame) {
    paintFrame(state, state.frames[frame], frame);
  }
}

function requestLocalFrame(state, frame) {
  state.targetFrame = clamp(Math.round(frame), 0, state.frameCount - 1);
  drawRequestedFrame(state);
}

function prepareNearbySequences(index) {
  const wanted = new Set([index]);
  if (index > 0) wanted.add(index - 1);

  wanted.forEach((candidate) => loadSequence(candidate).catch(console.error));

  sequences.forEach((_, candidate) => {
    if (!wanted.has(candidate) && Math.abs(candidate - index) > 1) {
      releaseSequence(candidate);
    }
  });
}

function activateSection(index) {
  if (index === activeIndex) return;
  activeIndex = index;

  sections.forEach((section, sectionIndex) => {
    section.classList.toggle('is-active', sectionIndex === index);
  });

  journeyDots.forEach((dot, dotIndex) => {
    dot.classList.toggle('active', dotIndex === index);
  });

  chapterCounter.textContent = String(index + 1).padStart(2, '0');
  prepareNearbySequences(index);
}

function locateGlobalFrame(globalFrame) {
  const safeFrame = clamp(globalFrame, 0, totalGlobalFrames - 1);

  for (let index = sequences.length - 1; index >= 0; index -= 1) {
    const offset = sequenceOffsets[index];
    if (safeFrame >= offset) {
      return {
        index,
        localFrame: Math.min(sequences[index].frameCount - 1, safeFrame - offset)
      };
    }
  }

  return { index: 0, localFrame: 0 };
}

function renderGlobalFrame(globalFrame) {
  const { index, localFrame } = locateGlobalFrame(globalFrame);
  const activeState = sequences[index];
  const localProgress = activeState.frameCount > 1
    ? localFrame / (activeState.frameCount - 1)
    : 0;

  activateSection(index);

  // Start loading the following scene before this scene ends, without
  // decoding every scene at startup and freezing the wheel response.
  if (localProgress > 0.35 && index < sequences.length - 1) {
    loadSequence(index + 1).catch(console.error);
  }

  sequences.forEach((state, stateIndex) => {
    let frame = 0;
    if (stateIndex < index) frame = state.frameCount - 1;
    if (stateIndex === index) frame = localFrame;

    requestLocalFrame(state, frame);

    const progress = state.frameCount > 1 ? frame / (state.frameCount - 1) : 0;
    state.progressBar.style.width = `${progress * 100}%`;
    state.canvas.style.transform = `scale(${stateIndex === index ? 1.012 + localProgress * 0.028 : 1.012})`;
  });

  const overallProgress = totalGlobalFrames > 1
    ? globalFrame / (totalGlobalFrames - 1)
    : 0;

  journeyFill.style.height = `${overallProgress * 100}%`;
  if (scrollCue) scrollCue.style.opacity = globalFrame > 2 ? '0' : '1';
}

function advanceOneFrame() {
  const difference = targetGlobalFrame - currentGlobalFrame;
  if (Math.abs(difference) < 0.5) {
    currentGlobalFrame = Math.round(targetGlobalFrame);
    renderGlobalFrame(currentGlobalFrame);
    return false;
  }

  currentGlobalFrame += difference > 0 ? 1 : -1;
  currentGlobalFrame = clamp(currentGlobalFrame, 0, totalGlobalFrames - 1);
  renderGlobalFrame(currentGlobalFrame);
  return true;
}

function animationStep() {
  if (!ready) {
    animationRunning = false;
    return;
  }

  const moved = advanceOneFrame();
  if (moved) {
    requestAnimationFrame(animationStep);
  } else {
    animationRunning = false;
  }
}

function ensureAnimation() {
  if (animationRunning) return;
  animationRunning = true;

  // Move the first frame immediately, so the response begins with this input event.
  const moved = advanceOneFrame();
  if (moved) requestAnimationFrame(animationStep);
  else animationRunning = false;
}

function addFrameIntent(frameDelta) {
  const unclampedTarget = targetGlobalFrame + frameDelta;
  const minimumTarget = currentGlobalFrame - MAX_FRAME_BACKLOG;
  const maximumTarget = currentGlobalFrame + MAX_FRAME_BACKLOG;

  targetGlobalFrame = clamp(
    unclampedTarget,
    Math.max(0, minimumTarget),
    Math.min(totalGlobalFrames - 1, maximumTarget)
  );

  ensureAnimation();
}

function normalizedWheelDelta(event) {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * window.innerHeight;
  return event.deltaY;
}

function onWheel(event) {
  if (!ready || event.ctrlKey) return;
  event.preventDefault();

  const frameDelta = normalizedWheelDelta(event) * FRAMES_PER_PIXEL;
  if (Math.abs(frameDelta) < 0.01) return;
  addFrameIntent(frameDelta);
}

function onKeyDown(event) {
  if (!ready) return;

  const forward = ['ArrowDown', 'PageDown', ' ', 'ArrowRight'];
  const backward = ['ArrowUp', 'PageUp', 'ArrowLeft'];

  if (forward.includes(event.key)) {
    event.preventDefault();
    addFrameIntent(KEYBOARD_FRAMES);
  } else if (backward.includes(event.key)) {
    event.preventDefault();
    addFrameIntent(-KEYBOARD_FRAMES);
  } else if (event.key === 'Home') {
    event.preventDefault();
    jumpDirectlyTo(0);
  } else if (event.key === 'End') {
    event.preventDefault();
    jumpDirectlyTo(totalGlobalFrames - 1);
  }
}

function jumpDirectlyTo(globalFrame) {
  targetGlobalFrame = clamp(Math.round(globalFrame), 0, totalGlobalFrames - 1);
  currentGlobalFrame = targetGlobalFrame;
  animationRunning = false;
  renderGlobalFrame(currentGlobalFrame);
}

function setupTouch() {
  let touching = false;
  let previousY = 0;

  window.addEventListener('touchstart', (event) => {
    if (!ready || event.touches.length !== 1) return;
    touching = true;
    previousY = event.touches[0].clientY;
  }, { passive: true });

  window.addEventListener('touchmove', (event) => {
    if (!ready || !touching || event.touches.length !== 1) return;
    event.preventDefault();

    const currentY = event.touches[0].clientY;
    const pixelDelta = previousY - currentY;
    previousY = currentY;
    addFrameIntent(pixelDelta * TOUCH_FRAMES_PER_PIXEL);
  }, { passive: false });

  window.addEventListener('touchend', () => {
    touching = false;
  }, { passive: true });
}

function setupNavigation() {
  journeyDots.forEach((dot) => {
    dot.addEventListener('click', (event) => {
      event.preventDefault();
      const index = Number(dot.dataset.index);
      jumpDirectlyTo(sequenceOffsets[index]);
    });
  });

  replayButton?.addEventListener('click', () => jumpDirectlyTo(0));
}

function setupSequences(manifest) {
  let offset = 0;

  sections.forEach((section, index) => {
    const canvas = section.querySelector('.story-canvas');
    const sequenceNumber = Number(canvas.dataset.sequence);
    const frameCount = manifest[String(sequenceNumber)]?.count ?? 120;

    sequenceOffsets.push(offset);

    const state = {
      index,
      sequenceNumber,
      frameCount,
      canvas,
      context: canvas.getContext('2d', { alpha: false, desynchronized: true }),
      progressBar: section.querySelector('.section-progress span'),
      frames: new Array(frameCount),
      currentFrame: -1,
      targetFrame: 0,
      ready: false,
      loading: null
    };

    resizeCanvas(state);
    sequences.push(state);
    offset += frameCount;
  });

  totalGlobalFrames = offset;
}

async function boot() {
  history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);

  const manifest = await fetch('./frames-manifest.json', { cache: 'no-cache' })
    .then((response) => response.json());

  setupSequences(manifest);

  const initialIndexes = [0];
  const totalFramesToLoad = sequences[0].frameCount;
  const loadedCounts = new Map([[0, 0]]);

  const updateLoader = () => {
    const loaded = Array.from(loadedCounts.values()).reduce((sum, value) => sum + value, 0);
    const percent = Math.round((loaded / totalFramesToLoad) * 100);
    loaderPercent.textContent = `${percent}%`;
    loaderBar.style.width = `${percent}%`;
  };

  await Promise.all(initialIndexes.map((index) => loadSequence(index, (loaded) => {
    loadedCounts.set(index, loaded);
    updateLoader();
  })));

  ready = true;
  document.body.classList.remove('is-loading');
  sequenceLoader.classList.add('is-hidden');

  setupNavigation();
  setupTouch();
  jumpDirectlyTo(0);

  document.addEventListener('wheel', onWheel, { passive: false, capture: true });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', () => {
    sequences.forEach((state) => {
      resizeCanvas(state);
      drawRequestedFrame(state);
    });
  }, { passive: true });
}

boot().catch((error) => {
  console.error(error);
  loaderPercent.textContent = 'Reload';
});
