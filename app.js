import { projects as originalProjects } from './data/projects.js';
import { initCinema } from './motion.js';
import { applyContent, listenForPreview, loadContent, safeMedia, safeUrl } from './cms.js';

let cmsContent = await loadContent();
let projects = normalizeProjects(cmsContent?.projects ?? originalProjects);
applyContent(cmsContent);

// Used only if both the content server and bundled document are unavailable.
// The console normally supplies editable project copy from the content document.
const fallbackStories = {
  cartup: {
    headline: 'Everyday finds.<br>Extraordinary ease.',
    description: 'A marketplace made for Bangladesh. From discovering the right product to a secure checkout and tracking it all the way home.',
    features: ['Product discovery', 'Secure checkout', 'Order tracking'],
    preview: [1, 3],
  },
  firsttrip: {
    headline: 'Next stop.<br>Anywhere.',
    description: 'Flights, stays, and new possibilities. A cross-platform travel experience that brings the whole journey together in one place.',
    features: ['Flights & hotels', 'Holiday packages', 'Visa assistance'],
    preview: [1, 3],
  },
  yspark: {
    headline: 'Every ride.<br>More connected.',
    description: 'A companion for the Yamaha community. Keeping service, warranty, and the next adventure just a few taps away.',
    features: ['Digital warranty', 'Service booking', 'Rider community'],
    preview: [1, 2],
  },
  medex: {
    headline: 'Clarity, when<br>it matters.',
    description: 'A medicine reference for Bangladesh. Bringing detailed drug information, smart search, and bilingual content into a focused mobile experience.',
    features: ['Medicine index', 'Smart search', 'Bilingual content'],
    preview: [1, 2],
  },
};

const storeLabels = { play: 'Google Play', appStore: 'App Store', aci: 'ACI Store', github: 'GitHub', website: 'Website' };
const appleIcon = '<svg class="apple" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 12.5c0-2 1.5-3 1.6-3.1-.9-1.3-2.3-1.5-2.8-1.5-1.2-.1-2.3.7-2.9.7s-1.5-.7-2.5-.6C9.1 8 7.8 8.8 7.1 10c-1.4 2.4-.4 6 1 8 .6 1 1.4 2 2.4 1.9 1-.1 1.3-.6 2.5-.6s1.5.6 2.5.6c1.1 0 1.7-1 2.3-1.9.8-1.1 1.1-2.1 1.1-2.2-.1 0-1.9-.8-1.9-3.3ZM15.2 6.6c.5-.7.9-1.6.8-2.6-.8 0-1.8.6-2.4 1.2-.5.6-1 1.6-.9 2.5.9.1 1.9-.5 2.5-1.1Z"/></svg>';
const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 3 15 9-15 9V3Zm0 0 10 13M5 21 15 8"/></svg>';
const aciStoreIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v10h16V10M3 10l2-6h14l2 6M3 10h18M9 20v-6h6v6"/></svg>';
const codeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16"/></svg>';
const globeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 7h14M5 17h14"/></svg>';
const storeIcons = { appStore: appleIcon, play: playIcon, aci: aciStoreIcon, github: codeIcon, website: globeIcon };
const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function normalizeProjects(items) {
  return items.filter(item => item && typeof item.id === 'string').map(item => ({
    ...item,
    name: String(item.name ?? ''),
    category: String(item.category ?? ''),
    description: String(item.description ?? ''),
    role: String(item.role ?? ''),
    icon: safeMedia(item.icon),
    screenshots: Array.isArray(item.screenshots) ? item.screenshots.map(safeMedia).filter(Boolean) : [],
    links: Object.fromEntries(['play', 'appStore', 'aci', 'github', 'website'].map(key => [key, safeUrl(item.links?.[key])])),
    linkStatuses: item.linkStatuses ?? {},
  }));
}
const currentEmail = () => cmsContent?.settings?.email ?? 'farhansadikgalib@gmail.com';
const platformNames = project => [project.links.appStore && 'iOS', project.links.play && 'Android', project.links.aci && 'ACI Store'].filter(Boolean);
const iconHTML = project => project.icon
  ? `<img class="app-icon" src="${escapeHTML(project.icon)}" alt="" width="48" height="48" loading="lazy">`
  : `<span class="app-monogram" aria-hidden="true">${escapeHTML(project.name.split(/\s+/).map(word => word[0]).slice(0, 2).join(''))}</span>`;

function storeShortcuts(project) {
  return Object.entries(project.links)
    .filter(([key, url]) => url && (['github', 'website'].includes(key) || project.linkStatuses[key] === 'available'))
    .map(([key, url]) => `<a class="store-shortcut" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHTML(project.name)} on ${storeLabels[key]}" title="${storeLabels[key]}">${storeIcons[key]}</a>`).join('');
}

function projectArtwork(project, story) {
  if (project.id === 'medex' && project.screenshots[1] === 'assets/projects/medex-screen-2.webp' && project.screenshots[2] === 'assets/projects/medex-screen-3.webp') {
    return `<div class="device showcase-device showcase-device-back"><div class="device-screen screen-medex-detail"><img src="${project.screenshots[2]}" alt="MedEx medicine dosage and administration interface" loading="lazy" width="600" height="1037"></div><div class="device-shine" aria-hidden="true"></div></div>
      <div class="device showcase-device showcase-device-front"><div class="device-screen screen-medex-bangla"><img src="${project.screenshots[1]}" alt="MedEx bilingual medicine reference interface" loading="lazy" width="600" height="1037"></div><div class="device-shine" aria-hidden="true"></div></div>`;
  }
  if (!project.screenshots.length) return `<div class="project-preview-empty" aria-hidden="true">${iconHTML(project)}<span>${escapeHTML(project.name)}</span></div>`;
  const preview = story.preview.filter(index => project.screenshots[index - 1]);
  const indices = [...new Set(preview.length ? preview : [1, Math.min(2, project.screenshots.length)])].slice(0, 2);
  return indices.map((imageIndex, index) => `<figure class="poster ${indices.length === 1 ? 'poster-single' : index === 0 ? 'poster-back' : 'poster-front'}"><img src="${escapeHTML(project.screenshots[imageIndex - 1])}" alt="${escapeHTML(project.name)} app preview ${imageIndex}" loading="lazy" width="600" height="1067"></figure>`).join('');
}

function renderFeatured() {
  const featured = projects.filter(project => project.featured);
  const work = document.querySelector('#work');
  work.style.setProperty('--showcase-height', `${100 + featured.length * 80}svh`);
  document.querySelector('.project-selector').innerHTML = featured.map((project, index) => `<button data-goto-project="${index}" aria-pressed="${index === 0}">${escapeHTML(project.name)}</button>`).join('');
  document.querySelector('.project-selector').hidden = featured.length < 2;
  document.querySelector('#featured-projects').innerHTML = featured.map((project, index) => {
    const fallback = Object.hasOwn(fallbackStories, project.id) ? fallbackStories[project.id] : undefined;
    const story = {
      headline: project.headline ?? fallback?.headline?.replace(/<br>/g, '\n') ?? project.name,
      description: project.summary ?? fallback?.description ?? project.description,
      features: Array.isArray(project.features) ? project.features : fallback?.features ?? [],
      preview: Array.isArray(project.preview) ? project.preview : fallback?.preview ?? [1, 2],
    };
    const platforms = platformNames(project).filter(platform => platform !== 'ACI Store');
    return `<article class="project-scene scene-${escapeHTML(project.id)}${index === 0 ? ' is-active' : ''}" data-chapter="${index}" aria-labelledby="title-${escapeHTML(project.id)}">
      <div class="scene-light" aria-hidden="true"></div><div class="scene-horizon" aria-hidden="true"></div>
      <div class="project-watermark" aria-hidden="true">${escapeHTML(project.name)}</div>
      <div class="scene-copy reveal">
        <div class="project-identity">${iconHTML(project)}<div><h3 id="title-${escapeHTML(project.id)}">${escapeHTML(project.name)}</h3><p>${[escapeHTML(project.category), platforms.join(' & ')].filter(Boolean).join(' · ')}</p></div></div>
        ${story.headline ? `<p class="scene-headline">${escapeHTML(story.headline)}</p>` : ''}
        ${story.description ? `<p class="scene-description">${escapeHTML(story.description)}</p>` : ''}
        ${story.features.length ? `<div class="project-features">${story.features.map(feature => `<span>${escapeHTML(feature)}</span>`).join('')}</div>` : ''}
        <div class="project-actions"><button class="button button-primary" data-project="${escapeHTML(project.id)}" aria-label="Explore ${escapeHTML(project.name)} project">Inside the project</button><div class="store-shortcuts">${storeShortcuts(project)}</div></div>
        ${project.role ? `<p class="scene-meta">My contribution · ${escapeHTML(project.role)}</p>` : ''}
      </div>
      <div class="scene-art reveal"><div class="art-floor" aria-hidden="true"></div>
        ${projectArtwork(project, story)}
        ${project.screenshots.length ? '<p class="store-art-caption">App previews</p>' : ''}
      </div>
    </article>`;
  }).join('');
  if (!featured.length) {
    work.hidden = true;
    document.querySelector('#work-intro').hidden = true;
    document.querySelectorAll('a[href="#work"]').forEach(link => { link.hidden = true; });
  }
  document.querySelector('.all-work-button > span').textContent = projects.length;
  document.querySelector('#archive-title').textContent = `${projects.length} ${projects.length === 1 ? 'app' : 'apps'}. Many possibilities.`;
  document.querySelectorAll('.work-intro [data-open-archive]').forEach(button => {
    const label = button.querySelector('[data-cms-text]') ?? button;
    label.textContent = label.textContent.replace(/\b\d+ projects\b/, `${projects.length} projects`);
  });
}

const projectDialog = document.querySelector('#project-dialog');
const archiveDialog = document.querySelector('#archive-dialog');

function openDialog(dialog) {
  dialog.showModal();
  document.body.classList.add('modal-open');
}

function openProject(id) {
  const project = projects.find(item => item.id === id);
  if (!project) return;
  const storeLinks = Object.entries(project.links).filter(([, url]) => url).map(([key, url]) => {
    const status = ['github', 'website'].includes(key) ? 'available' : project.linkStatuses[key];
    const suffix = status === 'unverified' ? ' · availability unconfirmed' : status === 'coming-soon' ? ' · coming soon' : '';
    return `<a class="button button-glass" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${storeLabels[key]}${suffix}</a>`;
  }).join('');
  const platforms = platformNames(project).join(' · ');
  document.querySelector('#project-detail').innerHTML = `<div class="detail-header">
    <div class="project-identity">${iconHTML(project)}<p class="eyebrow">${escapeHTML(project.category === 'Other' ? 'From the portfolio' : project.category)}</p></div>
    <h2 id="dialog-title">${escapeHTML(project.name)}</h2>
    <p class="detail-description">${escapeHTML(project.description || 'A project from my mobile application portfolio. Get in touch to discuss the work.')}</p>
    <dl class="detail-facts">
      ${project.role ? `<div><dt>My contribution</dt><dd>${escapeHTML(project.role)}</dd></div>` : ''}
      ${platforms ? `<div><dt>${project.linkStatus === 'available' ? 'Platforms & distribution' : 'Listed platforms'}</dt><dd>${escapeHTML(platforms)}</dd></div>` : ''}
      ${project.downloads ? `<div><dt>Google Play installs</dt><dd>${escapeHTML(project.downloads)}</dd></div>` : ''}
    </dl>
    <div class="detail-links">${storeLinks || (currentEmail() ? `<a class="button button-glass" href="${escapeHTML(safeUrl(`mailto:${currentEmail()}`))}">Let’s talk about this project</a>` : '')}</div>
  </div>
  ${project.screenshots.length ? `<div class="detail-gallery" tabindex="0" role="region" aria-label="${escapeHTML(project.name)} store screenshots; scroll horizontally to explore">${project.screenshots.map((src, index) => `<img src="${escapeHTML(src)}" alt="${escapeHTML(project.name)} official store screenshot ${index + 1}" loading="lazy">`).join('')}</div>` : ''}
  <p class="detail-caption">${project.screenshots.length ? 'Swipe or scroll to explore the app previews. ' : ''}${project.downloads ? 'Install bands are store-reported minimums, not active-user counts. ' : ''}${project.sourceDate ? `Portfolio directory snapshot: ${escapeHTML(project.sourceDate)}.` : 'Project details maintained by the portfolio owner.'}</p>`;
  openDialog(projectDialog);
  projectDialog.scrollTop = 0;
}

let activeCategory = 'All';
let searchTerm = '';

function renderFilters() {
  const filters = ['All', ...new Set(projects.map(project => project.category).filter(Boolean))];
  document.querySelector('#archive-filters').innerHTML = filters.map(category => `<button class="filter-button" data-category="${escapeHTML(category)}" aria-pressed="${category === activeCategory}">${escapeHTML(category)}</button>`).join('');
}

function renderArchive() {
  const filtered = projects.filter(project => (activeCategory === 'All' || project.category === activeCategory) && `${project.name} ${project.category} ${project.description}`.toLowerCase().includes(searchTerm));
  document.querySelector('#results-count').textContent = `${filtered.length} of ${projects.length} projects`;
  document.querySelector('#archive-grid').innerHTML = filtered.length ? filtered.map(project => `<button class="archive-card" data-project="${escapeHTML(project.id)}" aria-label="View ${escapeHTML(project.name)} project">
    ${iconHTML(project)}<h3>${escapeHTML(project.name)}</h3><p>${escapeHTML(project.description || 'From the mobile project collection.')}</p>
    <span class="archive-card-bottom">${project.linkStatus === 'coming-soon' ? 'Coming soon' : project.linkStatus === 'available' ? escapeHTML(project.category === 'Other' ? 'Project' : project.category) : 'Portfolio project'}</span>
  </button>`).join('') : '<p class="empty-state">No projects match that search. Try another name or category.</p>';
}

document.addEventListener('click', event => {
  const projectButton = event.target.closest('[data-project]');
  if (projectButton) openProject(projectButton.dataset.project);
  if (event.target.closest('[data-open-archive]')) {
    activeCategory = 'All';
    searchTerm = '';
    document.querySelector('#project-search').value = '';
    renderFilters();
    renderArchive();
    openDialog(archiveDialog);
    archiveDialog.scrollTop = 0;
  }
  const filterButton = event.target.closest('[data-category]');
  if (filterButton) {
    activeCategory = filterButton.dataset.category;
    document.querySelectorAll('[data-category]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category === activeCategory)));
    renderArchive();
  }
});

document.querySelector('#project-search').addEventListener('input', event => {
  searchTerm = event.target.value.trim().toLowerCase();
  renderArchive();
});

for (const dialog of [projectDialog, archiveDialog]) {
  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (!document.querySelector('dialog[open]')) document.body.classList.remove('modal-open');
  });
  // Only close on an actual backdrop click, not unused space inside the dialog.
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
}

// A disclosure navigation keeps the small-screen experience keyboard friendly.
const menuToggle = document.querySelector('.menu-toggle');
const mobileNav = document.querySelector('#mobile-nav');
function closeMenu(returnFocus = false) {
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', 'Open navigation');
  mobileNav.hidden = true;
  if (returnFocus) menuToggle.focus();
}
menuToggle.addEventListener('click', () => {
  const open = menuToggle.getAttribute('aria-expanded') !== 'true';
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  mobileNav.hidden = !open;
});
mobileNav.addEventListener('click', event => { if (event.target.closest('a')) closeMenu(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !mobileNav.hidden) closeMenu(true);
});
document.addEventListener('click', event => {
  if (!mobileNav.hidden && !event.target.closest('.site-header')) closeMenu();
});
matchMedia('(min-width: 761px)').addEventListener('change', event => { if (event.matches) closeMenu(); });

let toastTimer;
function notify(message) {
  const toast = document.querySelector('.toast');
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('visible');
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3000);
}
document.querySelector('.copy-email').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(currentEmail());
    notify('Email address copied. Let’s make something great.');
  } catch {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('.email-line > a'));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    notify('Email selected — use your device’s Copy command.');
  }
});

renderFeatured();
document.querySelector('#year').textContent = new Date().getFullYear();

// Reveal once. Reduced-motion changes are respected immediately, including mid-session.
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let revealObserver;
function configureReveals() {
  revealObserver?.disconnect();
  document.querySelectorAll('.reveal').forEach(element => element.classList.remove('is-pending'));
  if (motionPreference.matches || !('IntersectionObserver' in window)) return;
  revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.remove('is-pending');
      revealObserver.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -25px 0px', threshold: .035 });
  document.querySelectorAll('.reveal').forEach(element => {
    // Never hide already-visible content during initialization or a preference change.
    if (element.getBoundingClientRect().top < innerHeight - 25) return;
    element.classList.add('is-pending');
    revealObserver.observe(element);
  });
  document.querySelectorAll('.craft-grid, .package-grid').forEach(group => {
    [...group.children].forEach((child, index) => child.style.setProperty('--stagger', `${Math.min(index % 3, 2) * 70}ms`));
  });
}
configureReveals();
motionPreference.addEventListener('change', configureReveals);

let disposeCinema = initCinema();
listenForPreview(content => {
  disposeCinema?.();
  cmsContent = content;
  projects = normalizeProjects(content.projects);
  applyContent(content);
  renderFeatured();
  if (archiveDialog.open) { renderFilters(); renderArchive(); }
  if (projectDialog.open) projectDialog.close();
  configureReveals();
  disposeCinema = initCinema();
});
