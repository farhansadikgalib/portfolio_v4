// A travelling pointer in the style of v2.farhansadikgalib.com: the native cursor is hidden and a
// small arrow follows the mouse on a spring, turns toward its direction of travel, stretches a little
// at speed, and takes the accent colour over interactive elements. It lives in the top layer as a
// manual popover so native dialogs cannot cover it. Touch, reduced motion, and browsers without the
// popover API keep the ordinary cursor.
const fineQuery = matchMedia('(hover: hover) and (pointer: fine)');
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const INTERACTIVE = 'a, button, [role="button"], [data-cursor], input, textarea, select, label, summary';
const SHAPE = 'M2.5 2 L20.5 11.5 L10 13.2 L5 22 Z'; // Same arrow as v2.farhansadikgalib.com.
const TIP = { x: 3.18, y: 2.5 }; // Arrow tip in rendered pixels; it sits exactly under the pointer.

function spring(initial, stiffness, damping, mass) {
  const state = { value: initial, target: initial, velocity: 0 };
  state.jump = value => { state.value = state.target = value; state.velocity = 0; };
  state.step = dt => {
    const displacement = state.value - state.target;
    state.velocity += ((-stiffness * displacement) - (damping * state.velocity)) / mass * dt;
    state.value += state.velocity * dt;
    return Math.abs(state.velocity) > 0.01 || Math.abs(state.value - state.target) > 0.001;
  };
  return state;
}

const supported = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype && typeof requestAnimationFrame === 'function';
const root = document.createElement('div');
root.className = 'site-cursor';
root.setAttribute('aria-hidden', 'true');
root.setAttribute('popover', 'manual');
root.innerHTML = `<svg width="28" height="30" viewBox="0 0 22 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="${SHAPE}" stroke-linejoin="round" stroke-linecap="round"/></svg>`; // Constant markup only.
const svg = root.firstElementChild;
const x = spring(-100, 320, 30, 0.7);
const y = spring(-100, 320, 30, 0.7);
const rotation = spring(0, 240, 24, 0.5);
const scale = spring(1, 260, 22, 1);
const springs = [x, y, rotation, scale];
let frame = 0;
let last = 0;
let shown = false;
let lastX = 0;
let lastY = 0;
let lastTime = 0;
let enabled = false;
let observer = null;

function tick(now) {
  const dt = Math.min(Math.max(now - last, 0), 50) / 1000 || 0.016;
  last = now;
  const steps = Math.max(1, Math.ceil(dt / 0.008));
  const h = dt / steps;
  let active = false;
  for (let i = 0; i < steps; i++) for (const item of springs) active = item.step(h) || active;
  root.style.transform = `translate3d(${x.value.toFixed(2)}px, ${y.value.toFixed(2)}px, 0)`;
  svg.style.transform = `translate(${-TIP.x}px, ${-TIP.y}px) rotate(${rotation.value.toFixed(2)}deg) scale(${scale.value.toFixed(3)})`;
  frame = active ? requestAnimationFrame(tick) : 0;
}
function wake() {
  if (frame) return;
  last = performance.now();
  frame = requestAnimationFrame(tick);
}
function onMove(event) {
  if (!shown) {
    shown = true;
    x.jump(event.clientX);
    y.jump(event.clientY);
    lastX = event.clientX;
    lastY = event.clientY;
    lastTime = event.timeStamp;
    root.classList.add('is-visible');
  }
  x.target = event.clientX;
  y.target = event.clientY;
  root.classList.toggle('is-interactive', Boolean(event.target?.closest?.(INTERACTIVE)));
  const elapsed = Math.max(event.timeStamp - lastTime, 1);
  const vx = (event.clientX - lastX) / elapsed * 16;
  const vy = (event.clientY - lastY) / elapsed * 16;
  const speed = Math.hypot(vx, vy);
  if (speed > 0.35) {
    // The resting arrow points up-left; +135° makes it face the direction of travel by the shortest turn.
    const heading = (Math.atan2(vy, vx) * 180 / Math.PI) + 135;
    rotation.target += ((heading - rotation.target + 540) % 360) - 180;
  }
  scale.target = 1 + Math.min(speed / 700, 0.18);
  lastX = event.clientX;
  lastY = event.clientY;
  lastTime = event.timeStamp;
  wake();
}
const onLeave = () => root.classList.remove('is-visible');
const onEnter = () => { if (shown) root.classList.add('is-visible'); };
function raise() {
  // A dialog opened after the pointer would sit above it in the top layer; re-showing moves the pointer back on top.
  if (!root.isConnected || !root.matches(':popover-open')) return;
  root.hidePopover();
  root.showPopover();
}

function enable() {
  if (enabled || !supported) return;
  enabled = true;
  document.body.append(root);
  root.showPopover();
  document.documentElement.classList.add('cursor-none');
  window.addEventListener('mousemove', onMove, { passive: true });
  document.addEventListener('mouseleave', onLeave);
  document.addEventListener('mouseenter', onEnter);
  observer = new MutationObserver(records => { if (records.some(record => record.target.tagName === 'DIALOG' && record.target.open)) raise(); });
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
}
function disable() {
  if (!enabled) return;
  enabled = false;
  shown = false;
  window.removeEventListener('mousemove', onMove);
  document.removeEventListener('mouseleave', onLeave);
  document.removeEventListener('mouseenter', onEnter);
  observer?.disconnect();
  observer = null;
  cancelAnimationFrame(frame);
  frame = 0;
  document.documentElement.classList.remove('cursor-none');
  root.classList.remove('is-visible', 'is-interactive');
  if (root.matches(':popover-open')) root.hidePopover();
  root.remove();
}
function sync() { if (fineQuery.matches && !motionQuery.matches) enable(); else disable(); }
fineQuery.addEventListener('change', sync);
motionQuery.addEventListener('change', sync);
if (document.body) sync(); else document.addEventListener('DOMContentLoaded', sync, { once: true });
