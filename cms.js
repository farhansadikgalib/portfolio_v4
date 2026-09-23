// The public renderer only reads published content. Drafts require an authenticated
// server response, even when someone manually adds ?preview=1 to the URL.
const previewRequested = new URLSearchParams(location.search).get('preview') === '1';
let authenticatedPreview = false;

export function safeUrl(value = '') {
  const url = String(value).trim();
  if (!url || /[\u0000-\u001f\u007f]/.test(url)) return '';
  if (/^#[a-z\d_-]+$/i.test(url)) return url;
  if (/^(?:\/?assets\/|\/?uploads\/)[a-z\d_./%-]+$/i.test(url) && !url.includes('..')) return url;
  if (/^[a-z\d_-]+\.pdf$/i.test(url)) return url;
  try {
    const parsed = new URL(url);
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(parsed.protocol) ? url : '';
  } catch { return ''; }
}

export function safeMedia(value = '') {
  const path = String(value).trim();
  return /^(?:\/?assets\/|\/?uploads\/)[a-z\d_./%-]+$/i.test(path) && !path.includes('..') ? path : '';
}

async function readJSON(path) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Content is unavailable (${response.status}).`);
  return response.json();
}

function isDocument(value) {
  return value?.schemaVersion === 1 && Array.isArray(value.sections) && Array.isArray(value.fields) && Array.isArray(value.projects);
}

export async function loadContent() {
  if (previewRequested) {
    try {
      const content = await readJSON('/api/admin/content');
      if (isDocument(content.draft)) {
        authenticatedPreview = true;
        return content.draft;
      }
    } catch { /* An unsigned preview URL never exposes unpublished content. */ }
  }
  for (const path of ['/api/content', './data/default-content.json']) {
    try {
      const content = await readJSON(path);
      if (isDocument(content)) return content;
    } catch { /* Static hosting continues to work with the bundled content. */ }
  }
  return null;
}

const main = document.querySelector('main');
const builtinSections = new Map([...main.children].filter(element => element.tagName === 'SECTION').map(element => [
  element.id || (element.classList.contains('work-intro') ? 'work-intro' : element.classList.contains('manifesto') ? 'approach' : ''), element,
]));
const originalLinks = new Map([...document.querySelectorAll('a[href]')].map(element => [element, element.getAttribute('href')]));
const originalFields = new Map([...document.querySelectorAll('[data-cms-text], [data-cms-link], [data-cms-image]')].map(element => [element, {
  text: element.textContent,
  href: element.getAttribute('href'),
  src: element.getAttribute('src'),
  alt: element.getAttribute('alt'),
}]));

function setLink(element, value) {
  const url = safeUrl(value);
  if (url) {
    element.setAttribute('href', url);
    element.hidden = false;
  } else {
    element.removeAttribute('href');
    element.hidden = true;
  }
}

function applyFields(fields) {
  const byId = new Map(fields.map(field => [field.id, field]));
  for (const [element, original] of originalFields) {
    const textField = byId.get(element.dataset.cmsText);
    if (element.hasAttribute('data-cms-text')) element.textContent = textField ? String(textField.value ?? '') : original.text;
    const linkField = byId.get(element.dataset.cmsLink);
    if (element.hasAttribute('data-cms-link')) setLink(element, linkField ? linkField.value : original.href);
    if (!element.hasAttribute('data-cms-image')) continue;
    const field = byId.get(element.dataset.cmsImage);
    const source = safeMedia(field ? field.value : original.src);
    element.hidden = !source;
    element.closest('.device')?.toggleAttribute('hidden', !source);
    if (source) element.src = source;
    else element.removeAttribute('src');
    element.alt = String(field?.alt ?? original.alt ?? '');
    const fit = ['contain', 'cover'].includes(field?.fit) ? field.fit : source !== original.src ? 'contain' : 'original';
    element.dataset.cmsFit = fit;
  }
  const heroShowcase = document.querySelector('.hero-showcase');
  if (heroShowcase) {
    const visibleImages = [...heroShowcase.querySelectorAll('[data-cms-image]')].filter(image => !image.hidden);
    heroShowcase.hidden = visibleImages.length === 0;
    heroShowcase.closest('.hero-composition')?.classList.toggle('cms-no-hero-art', visibleImages.length === 0);
  }
}

function applySettings(settings = {}) {
  if (typeof settings.name === 'string') {
    const wordmark = document.querySelector('.site-header .wordmark');
    wordmark?.querySelector('small')?.replaceChildren(document.createTextNode(settings.name));
    wordmark?.setAttribute('aria-label', `${settings.name}, home`);
    const year = document.querySelector('#year');
    if (year?.parentElement.closest('.site-footer')) {
      while (year.nextSibling) year.nextSibling.remove();
      year.after(document.createTextNode(` ${settings.name}`));
    }
    document.querySelector('.contact-links')?.setAttribute('aria-label', `Connect with ${settings.name}`);
  }
  if (typeof settings.title === 'string') {
    document.title = settings.title;
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', settings.title);
  }
  if (typeof settings.description === 'string') {
    document.querySelector('meta[name="description"]')?.setAttribute('content', settings.description);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', settings.description);
  }
  for (const [element, href] of originalLinks) {
    if (href.startsWith('mailto:') && typeof settings.email === 'string') setLink(element, settings.email ? `mailto:${settings.email}` : '');
    else if (href.startsWith('tel:') && typeof settings.phone === 'string') setLink(element, settings.phone ? `tel:${settings.phone}` : '');
    else if (/^https:\/\/(?:www\.)?github.com\/farhansadikgalib\/?$/.test(href) && typeof settings.github === 'string') setLink(element, settings.github);
    else if (/^https:\/\/(?:www\.)?linkedin.com\/in\/farhansadikgalib\/?$/.test(href) && typeof settings.linkedin === 'string') setLink(element, settings.linkedin);
    else if (/^https:\/\/medium.com\/@farhansadikgalib\/?$/.test(href) && typeof settings.medium === 'string') setLink(element, settings.medium);
  }
  const email = document.querySelector('.email-line > a');
  if (email && typeof settings.email === 'string') email.textContent = settings.email;
  const copy = document.querySelector('.copy-email');
  if (copy && typeof settings.email === 'string') copy.hidden = !settings.email;
}

function customSection(section) {
  const element = document.createElement('section');
  element.id = section.id;
  element.className = `cms-section section-shell cms-section-${section.kind}`;
  element.dataset.cmsCustom = '';
  const panel = document.createElement('div');
  panel.className = 'cms-section-panel reveal';
  if (section.title) {
    const heading = document.createElement('h2');
    heading.textContent = section.title;
    heading.id = `cms-title-${section.id}`;
    element.setAttribute('aria-labelledby', heading.id);
    panel.append(heading);
  }
  if (section.body) {
    const body = document.createElement('p');
    body.textContent = section.body;
    panel.append(body);
  }
  if (section.kind === 'image' && safeMedia(section.image)) {
    const image = document.createElement('img');
    image.src = safeMedia(section.image);
    image.alt = String(section.imageAlt ?? '');
    image.loading = 'lazy';
    image.decoding = 'async';
    panel.append(image);
  }
  if (section.linkLabel && safeUrl(section.linkUrl)) {
    const link = document.createElement('a');
    link.className = section.kind === 'cta' ? 'button button-primary' : 'button button-glass';
    link.textContent = section.linkLabel;
    setLink(link, section.linkUrl);
    if (/^https?:/.test(section.linkUrl)) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    panel.append(link);
  }
  element.append(panel);
  return element;
}

function applySections(sections, projects) {
  main.querySelectorAll(':scope > [data-cms-custom]').forEach(element => element.remove());
  for (const element of builtinSections.values()) element.hidden = true;
  const hasFeaturedProjects = projects.some(project => project.featured);
  const workEnabled = hasFeaturedProjects && sections.some(section => section.id === 'work' && section.visible !== false);
  const seenIds = new Set();
  for (const section of sections) {
    if (!/^[a-z][a-z\d_-]{0,79}$/.test(section.id) || seenIds.has(section.id)) continue;
    seenIds.add(section.id);
    if (section.kind !== 'builtin' && (!['text', 'image', 'cta'].includes(section.kind) || builtinSections.has(section.id) || document.getElementById(section.id))) continue;
    const element = section.kind === 'builtin' ? builtinSections.get(section.id) : customSection(section);
    if (!element) continue;
    element.id = section.id;
    element.hidden = section.visible === false || (section.id === 'work-intro' && !workEnabled) || (section.id === 'work' && !hasFeaturedProjects);
    element.dataset.cmsSpacing = section.spacing === 'compact' ? 'compact' : 'comfortable';
    main.append(element);
  }
  const visible = [...main.children].filter(element => !element.hidden);
  for (const [anchor, originalHref] of originalLinks) {
    if (!originalHref.startsWith('#') || ['#main', '#'].includes(originalHref)) continue;
    if (!anchor.hasAttribute('data-cms-link')) anchor.setAttribute('href', originalHref);
    const currentHref = anchor.getAttribute('href') ?? '';
    const target = currentHref.startsWith('#') ? document.getElementById(currentHref.slice(1)) : null;
    const hidden = !target || target.hidden || !!target.closest('section[hidden]');
    if (hidden && originalHref === '#home' && (anchor.classList.contains('wordmark') || anchor.closest('.site-footer'))) {
      anchor.href = visible[0]?.id ? `#${visible[0].id}` : '#main';
      anchor.hidden = false;
    } else {
      // A CMS link may replace the original section link with an external URL.
      anchor.hidden = currentHref.startsWith('#') ? hidden : !currentHref;
    }
  }
  for (const anchor of main.querySelectorAll('[data-cms-custom] a[href^="#"]')) {
    const target = document.getElementById(anchor.getAttribute('href').slice(1));
    anchor.hidden = !target || target.hidden || Boolean(target.closest('section[hidden]'));
  }
}

export function applyContent(content) {
  if (!isDocument(content)) return;
  applyFields(content.fields);
  applySettings(content.settings);
  applySections(content.sections, content.projects);
  document.documentElement.classList.toggle('cms-preview', authenticatedPreview);
}

export function listenForPreview(onChange) {
  if (!authenticatedPreview || window.parent === window) return;
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'portfolio-preview' || !isDocument(event.data.document)) return;
    onChange(event.data.document);
  });
}
