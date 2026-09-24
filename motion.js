// A small scroll director. Layout is measured on resize; scrolling only updates
// cached scene values. CSS owns the visual treatment and the static fallback.
const clamp = value => Math.min(1, Math.max(0, value));
let disposePrevious;

export function initCinema() {
  disposePrevious?.();

  const root = document.documentElement;
  const body = document.body;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const compactLayout = matchMedia('(max-width: 760px), (max-height: 700px)');
  const progressBar = document.querySelector('.chapter-progress span');
  const projectButtons = [...document.querySelectorAll('[data-goto-project]')];
  const originalStyles = [];
  const originalAttributes = [];
  const originalClasses = [];
  const activeScenes = new Set();
  const dirtyScenes = new Set();
  let frame = 0;
  let needsMeasure = true;
  let disposed = false;
  let ready = false;
  let viewportHeight = innerHeight;
  let pageTravel = 1;
  let lastPageProgress = '';

  function rememberStyle(element, property) {
    if (!element) return;
    originalStyles.push([element, property, element.style.getPropertyValue(property), element.style.getPropertyPriority(property)]);
  }

  function rememberAttribute(element, attribute) {
    originalAttributes.push([element, attribute, element.getAttribute(attribute)]);
  }

  function rememberClass(element, className) {
    originalClasses.push([element, className, element.classList.contains(className)]);
  }

  rememberStyle(root, '--page-progress');
  rememberStyle(progressBar, 'transform');
  rememberClass(body, 'cinema-ready');
  projectButtons.forEach(button => rememberAttribute(button, 'aria-pressed'));

  const scenes = [...document.querySelectorAll('[data-cinema]')].filter(element => !element.closest('[hidden]')).map(element => {
    ['--scene-progress', '--scene-enter', '--chapter-progress'].forEach(property => rememberStyle(element, property));
    const words = [...element.querySelectorAll('.manifesto-word')].map((word, index, all) => {
      rememberStyle(word, '--word-light');
      rememberStyle(word, '--word-index');
      word.style.setProperty('--word-index', String(index));
      return { element: word, start: .05 + (index / Math.max(1, all.length - 1)) * .65, last: '' };
    });
    const chapters = element.dataset.cinema === 'showcase'
      ? [...element.querySelectorAll('[data-chapter]')]
      : [];
    chapters.forEach(chapter => {
      rememberClass(chapter, 'is-active');
      rememberAttribute(chapter, 'aria-hidden');
      rememberAttribute(chapter, 'inert');
    });
    return { element, words, chapters, top: 0, travel: 1, lastProgress: '', lastEnter: '', lastChapterProgress: '', chapterIndex: -1 };
  });
  const sceneByElement = new Map(scenes.map(scene => [scene.element, scene]));
  const showcases = scenes.filter(scene => scene.chapters.length);
  const cinematic = () => !reducedMotion.matches && !compactLayout.matches;

  function requestPaint() {
    if (frame || disposed || document.hidden || !cinematic()) return;
    frame = requestAnimationFrame(paint);
  }

  function measure() {
    const scrollTop = window.scrollY;
    viewportHeight = Math.max(1, window.innerHeight);
    // All layout reads happen together, before any progress styles are written.
    for (const scene of scenes) {
      const rect = scene.element.getBoundingClientRect();
      scene.top = rect.top + scrollTop;
      scene.travel = Math.max(1, rect.height - viewportHeight);
      dirtyScenes.add(scene);
    }
    pageTravel = Math.max(1, root.scrollHeight - viewportHeight);
    needsMeasure = false;
  }

  function setChapter(scene, index) {
    if (scene.chapterIndex === index) return;
    scene.chapterIndex = index;
    const buttons = projectButtons.filter(button => {
      const owner = button.closest('[data-cinema="showcase"]');
      return owner ? owner === scene.element : scene === showcases[0];
    });
    // Keep keyboard focus available if a focused panel leaves the stage.
    const focusedChapter = scene.chapters.find(chapter => chapter.contains(document.activeElement));
    if (focusedChapter && focusedChapter !== scene.chapters[index]) {
      buttons.find(button => Number(button.dataset.gotoProject) === index)?.focus({ preventScroll: true });
    }
    scene.chapters.forEach((chapter, chapterIndex) => {
      const active = chapterIndex === index;
      chapter.classList.toggle('is-active', active);
      chapter.setAttribute('aria-hidden', String(!active));
      chapter.toggleAttribute('inert', !active);
    });
    buttons.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.gotoProject) === index)));
    const activeButton = buttons.find(button => Number(button.dataset.gotoProject) === index);
    const selector = activeButton?.parentElement;
    if (selector && selector.scrollWidth > selector.clientWidth) {
      // Only move the selector horizontally; scrollIntoView here would also
      // pull the entire page toward a scene that is still below the viewport.
      const buttonBounds = activeButton.getBoundingClientRect();
      const selectorBounds = selector.getBoundingClientRect();
      if (buttonBounds.left < selectorBounds.left || buttonBounds.right > selectorBounds.right) {
        selector.scrollLeft += buttonBounds.left - selectorBounds.left - (selectorBounds.width - buttonBounds.width) / 2;
      }
    }
  }

  function paint() {
    frame = 0;
    if (disposed || document.hidden || !cinematic()) return;
    if (!ready) {
      // The class and first progress values land in the same frame. Without
      // JavaScript (or with reduced motion), the content remains in normal flow.
      body.classList.add('cinema-ready');
      ready = true;
      needsMeasure = true;
    }
    if (needsMeasure) measure();

    const scrollTop = window.scrollY;
    const pageProgress = clamp(scrollTop / pageTravel).toFixed(5);
    if (pageProgress !== lastPageProgress) {
      root.style.setProperty('--page-progress', pageProgress);
      if (progressBar) progressBar.style.transform = `scaleX(${pageProgress})`;
      lastPageProgress = pageProgress;
    }

    const pending = new Set([...activeScenes, ...dirtyScenes]);
    dirtyScenes.clear();
    for (const scene of pending) {
      const top = scene.top - scrollTop;
      const progress = clamp(-top / scene.travel);
      const progressText = progress.toFixed(5);
      const enterText = clamp((viewportHeight - top) / viewportHeight).toFixed(5);
      if (scene.lastProgress !== progressText) {
        scene.element.style.setProperty('--scene-progress', progressText);
        scene.lastProgress = progressText;
        for (const word of scene.words) {
          const light = clamp((progress - word.start) / .1).toFixed(4);
          if (word.last === light) continue;
          word.element.style.setProperty('--word-light', light);
          word.last = light;
        }
      }
      if (scene.lastEnter !== enterText) {
        scene.element.style.setProperty('--scene-enter', enterText);
        scene.lastEnter = enterText;
      }
      if (scene.chapters.length) {
        const scaled = progress * scene.chapters.length;
        const index = Math.min(scene.chapters.length - 1, Math.floor(scaled));
        const chapterProgress = (progress === 1 ? 1 : scaled - index).toFixed(5);
        setChapter(scene, index);
        if (scene.lastChapterProgress !== chapterProgress) {
          scene.element.style.setProperty('--chapter-progress', chapterProgress);
          scene.lastChapterProgress = chapterProgress;
        }
      }
    }
  }

  const intersectionObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => {
      for (const entry of entries) {
        const scene = sceneByElement.get(entry.target);
        if (entry.isIntersecting) activeScenes.add(scene);
        else activeScenes.delete(scene);
        // Paint the leaving boundary once, including jumps past a whole scene.
        dirtyScenes.add(scene);
      }
      requestPaint();
    }, { rootMargin: '100% 0px 100% 0px' })
    : null;

  function invalidate() {
    needsMeasure = true;
    requestPaint();
  }

  function configure() {
    cancelAnimationFrame(frame);
    frame = 0;
    intersectionObserver?.disconnect();
    activeScenes.clear();
    dirtyScenes.clear();
    ready = false;
    needsMeasure = true;
    lastPageProgress = '';
    body.classList.remove('cinema-ready');

    for (const scene of scenes) {
      scene.lastProgress = '';
      scene.lastEnter = '';
      scene.lastChapterProgress = '';
      scene.chapterIndex = -1;
      scene.words.forEach(word => { word.last = ''; });
    }

    if (!cinematic()) {
      root.style.setProperty('--page-progress', '0');
      if (progressBar) progressBar.style.transform = 'scaleX(0)';
      for (const scene of scenes) {
        scene.element.style.setProperty('--scene-progress', '0');
        scene.element.style.setProperty('--scene-enter', '1');
        scene.element.style.setProperty('--chapter-progress', '0');
        scene.words.forEach(word => word.element.style.setProperty('--word-light', '1'));
        scene.chapters.forEach(chapter => {
          chapter.classList.remove('is-active');
          chapter.removeAttribute('aria-hidden');
          chapter.removeAttribute('inert');
        });
      }
      projectButtons.forEach(button => button.setAttribute('aria-pressed', 'false'));
      return;
    }

    scenes.forEach(scene => {
      dirtyScenes.add(scene);
      if (intersectionObserver) intersectionObserver.observe(scene.element);
      else activeScenes.add(scene);
    });
    requestPaint();
  }

  function onVisibilityChange() {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else {
      invalidate();
    }
  }

  function onProjectClick(event) {
    const button = event.target.closest?.('[data-goto-project]');
    if (!button) return;
    const owner = button.closest('[data-cinema="showcase"]');
    const scene = owner ? sceneByElement.get(owner) : showcases[0];
    const index = Number(button.dataset.gotoProject);
    if (!scene || !Number.isInteger(index) || index < 0 || index >= scene.chapters.length) return;
    event.preventDefault();
    const behavior = reducedMotion.matches ? 'instant' : 'smooth';
    if (cinematic()) {
      // Read fresh metrics because navigation can happen immediately on resize.
      const rect = scene.element.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      const travel = Math.max(1, rect.height - window.innerHeight);
      window.scrollTo({ top: top + travel * ((index + .16) / scene.chapters.length), behavior });
    } else {
      scene.chapters[index].scrollIntoView({ block: 'start', behavior });
      projectButtons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    }
  }

  const resizeObserver = 'ResizeObserver' in window ? new ResizeObserver(invalidate) : null;
  resizeObserver?.observe(body);
  scenes.forEach(scene => resizeObserver?.observe(scene.element));
  window.addEventListener('scroll', requestPaint, { passive: true });
  window.addEventListener('resize', invalidate, { passive: true });
  window.visualViewport?.addEventListener('resize', invalidate, { passive: true });
  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('click', onProjectClick);
  reducedMotion.addEventListener('change', configure);
  compactLayout.addEventListener('change', configure);
  document.fonts?.ready.then(() => { if (!disposed) invalidate(); });
  configure();

  function cleanup() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    intersectionObserver?.disconnect();
    resizeObserver?.disconnect();
    window.removeEventListener('scroll', requestPaint);
    window.removeEventListener('resize', invalidate);
    window.visualViewport?.removeEventListener('resize', invalidate);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.removeEventListener('click', onProjectClick);
    reducedMotion.removeEventListener('change', configure);
    compactLayout.removeEventListener('change', configure);
    for (const [element, property, value, priority] of originalStyles) {
      if (value) element.style.setProperty(property, value, priority);
      else element.style.removeProperty(property);
    }
    for (const [element, attribute, value] of originalAttributes) {
      if (value === null) element.removeAttribute(attribute);
      else element.setAttribute(attribute, value);
    }
    for (const [element, className, present] of originalClasses) element.classList.toggle(className, present);
    activeScenes.clear();
    dirtyScenes.clear();
    if (disposePrevious === cleanup) disposePrevious = undefined;
  }

  disposePrevious = cleanup;
  return cleanup;
}

// Pointer light for the opening. A fine pointer nudges the light rig through
// --px/--py on the stage (each in -1..1). Content never follows the pointer,
// and reduced motion or a coarse pointer leaves the rig centred.
export function initHeroPointer() {
  const stage = document.querySelector('.hero-stage');
  if (!stage) return () => {};
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let x = 0;
  let y = 0;
  let visible = true;
  const active = () => visible && finePointer.matches && !reducedMotion.matches;

  function paint() {
    frame = 0;
    stage.style.setProperty('--px', x.toFixed(3));
    stage.style.setProperty('--py', y.toFixed(3));
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(paint);
  }
  function onMove(event) {
    if (!active()) return;
    x = clamp(event.clientX / Math.max(1, innerWidth)) * 2 - 1;
    y = clamp(event.clientY / Math.max(1, innerHeight)) * 2 - 1;
    schedule();
  }
  function reset() {
    x = 0;
    y = 0;
    schedule();
  }
  const observer = 'IntersectionObserver' in window
    ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (!visible) reset(); })
    : null;
  observer?.observe(stage);
  window.addEventListener('pointermove', onMove, { passive: true });
  document.documentElement.addEventListener('pointerleave', reset);
  finePointer.addEventListener('change', reset);
  reducedMotion.addEventListener('change', reset);

  return () => {
    cancelAnimationFrame(frame);
    frame = 0;
    observer?.disconnect();
    window.removeEventListener('pointermove', onMove);
    document.documentElement.removeEventListener('pointerleave', reset);
    finePointer.removeEventListener('change', reset);
    reducedMotion.removeEventListener('change', reset);
    stage.style.removeProperty('--px');
    stage.style.removeProperty('--py');
  };
}
