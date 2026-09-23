const app = document.querySelector('#app');
const mediaDialog = document.querySelector('#media-dialog');
const toastElement = document.querySelector('#toast');
const tabs = ['builder', 'content', 'projects', 'media', 'account'];
const tabNames = { builder: 'Page builder', content: 'Content', projects: 'Projects', media: 'Media', account: 'Account' };
const state = {
  session: null, document: null, revision: null, savedJSON: '', publishedJSON: '',
  updatedAt: null, publishedAt: null, saving: false, conflict: false,
  tab: tabs.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'builder',
  section: null, contentSection: 'settings', project: null, previewSize: 'desktop',
  media: [], mediaLoaded: false, mediaLoading: false, mediaError: '',
};
let toastTimer;
let previewVersion = 0;
let mediaPicker = null;
let previewObserver = null;

// All editable content is inserted as text or form values, never executable HTML.
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'hidden') node[key] = value;
    else node.setAttribute(key, String(value));
  }
  children.flat(Infinity).forEach(child => {
    if (child !== undefined && child !== null && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}
function icon(name) {
  const paths = {
    builder: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 9v12"/>',
    content: '<path d="M7 3h8l4 4v14H5V3h2Zm7 0v5h5M8 12h8M8 16h6"/>',
    projects: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    media: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.4"/><path d="m3 17 6-6 5 5 3-3 4 4"/>',
    account: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    visible: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    hidden: '<path d="m3 3 18 18M10 5h2c6.5 0 10 7 10 7a19 19 0 0 1-3 4M6 6c-3 2-4 6-4 6s3.5 7 10 7c2 0 4-.8 5-2"/>',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = paths[name] || paths.content; // Only constant paths above.
  return svg;
}
function button(text, onClick, variant = '', props = {}) {
  return el('button', { type: 'button', class: `btn ${variant}`, onClick, ...props }, text);
}
function field(label, value, onChange, options = {}) {
  const id = `input-${crypto.randomUUID()}`;
  const props = { id, value: value ?? '', onInput: event => onChange(event.target.value), ...options };
  delete props.help; delete props.multiline; delete props.full;
  const input = el(options.multiline ? 'textarea' : 'input', { type: options.type || 'text', ...props });
  return el('div', { class: `field${options.full ? ' full' : ''}` },
    el('label', { class: 'field-label', for: id }, label), input,
    options.help ? el('p', { class: 'field-help' }, options.help) : null);
}
function selectField(label, value, choices, onChange) {
  const id = `select-${crypto.randomUUID()}`;
  const select = el('select', { id, onChange: event => onChange(event.target.value) },
    choices.map(choice => el('option', { value: choice.value ?? choice }, choice.label ?? choice)));
  select.value = value;
  return el('div', { class: 'field' }, el('label', { class: 'field-label', for: id }, label), select);
}
function checkField(label, checked, onChange) {
  return el('label', { class: 'check-field' }, el('input', { type: 'checkbox', checked, onChange: event => onChange(event.target.checked) }), label);
}
function panel(title, subtitle, body, actions) {
  return el('section', { class: 'panel' }, el('div', { class: 'panel-heading' },
    el('div', {}, el('h2', {}, title), subtitle ? el('p', {}, subtitle) : null), actions),
  el('div', { class: 'panel-body' }, body));
}
function heading(title, subtitle, action) {
  return el('div', { class: 'page-heading' }, el('div', {}, el('h1', {}, title), el('p', {}, subtitle)), action);
}
function notify(message, error = false) {
  clearTimeout(toastTimer);
  toastElement.textContent = message;
  toastElement.classList.toggle('error', error);
  toastElement.hidden = false;
  toastTimer = setTimeout(() => { toastElement.hidden = true; }, error ? 8000 : 4200);
}
function dirty() { return !!state.document && JSON.stringify(state.document) !== state.savedJSON; }
function markChanged() { updateSaveState(); }
function changed(object, key, value) { object[key] = value; markChanged(); }
function dateLabel(date) {
  if (!date) return 'Not yet';
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? 'Not yet' : parsed.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function fileSize(bytes) { return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.round((bytes || 0) / 1024)} KB`; }
function imageURL(src) { return src && !src.startsWith('/') ? `/${src}` : src; }
function thumbnail(src, alt = '', props = {}) {
  return src ? el('img', { src: imageURL(src), alt, loading: 'lazy', ...props }) : el('span', { class: 'quiet' }, 'No image');
}

async function api(path, { method = 'GET', body } = {}) {
  if (method !== 'GET' && body === undefined) body = {};
  const response = await fetch(path, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' && state.session?.csrfToken ? { 'x-csrf-token': state.session.csrfToken } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let result;
  try { result = await response.json(); } catch { throw new Error('The console needs the portfolio server. Run npm run dev and open /admin/ on the server address.'); }
  if (!response.ok) {
    const error = new Error(result.error || `Request failed (${response.status}). Please try again.`);
    error.status = response.status;
    if (response.status === 409 && ['/api/admin/content', '/api/admin/publish', '/api/admin/discard'].includes(path)) {
      state.conflict = true;
      updateConflictNotice();
    }
    if (response.status === 401 && path !== '/api/login') {
      state.session = { configured: true, authenticated: false };
      renderLogin('Your session has expired. Sign in again to continue. Unsaved edits are kept in this tab.');
    }
    throw error;
  }
  return result;
}
function adoptEnvelope(result, reset = true) {
  if (reset) state.document = structuredClone(result.draft);
  state.revision = result.revision;
  state.updatedAt = result.updatedAt;
  state.publishedAt = result.publishedAt;
  state.savedJSON = JSON.stringify(result.draft);
  state.publishedJSON = JSON.stringify(result.published);
  state.conflict = false;
  state.section ||= state.document.sections[0]?.id;
  state.project ||= state.document.projects[0]?.id;
  state.mediaLoaded = false;
}
async function loadContent(preserveEdits = false) {
  const result = await api('/api/admin/content');
  if (preserveEdits && state.document && dirty()) {
    // Keep the original revision so concurrent edits produce a conflict instead of overwriting them.
    state.publishedAt = result.publishedAt;
    state.publishedJSON = JSON.stringify(result.published);
  } else adoptEnvelope(result);
  renderShell();
}
async function saveDraft({ quiet = false } = {}) {
  if (state.saving || !state.document) return false;
  if (!dirty()) return true;
  state.saving = true;
  updateSaveState();
  const snapshot = structuredClone(state.document);
  try {
    let result = await api('/api/admin/content', { method: 'PUT', body: { document: snapshot, revision: state.revision } });
    if (!result.draft) result = await api('/api/admin/content');
    const editedDuringSave = JSON.stringify(state.document) !== JSON.stringify(snapshot);
    adoptEnvelope(result, !editedDuringSave);
    if (!quiet) notify('Draft saved. Publish when you’re ready to update the live site.');
    return true;
  } catch (error) { notify(error.message, true); return false; }
  finally { state.saving = false; updateSaveState(); updateConflictNotice(); if (state.tab === 'media' && state.session?.authenticated) renderShell(); }
}
async function publish() {
  if (state.saving) return;
  if (!(await saveDraft({ quiet: true }))) return;
  state.saving = true;
  updateSaveState();
  try {
    let result = await api('/api/admin/publish', { method: 'POST', body: { revision: state.revision } });
    if (!result.draft) result = await api('/api/admin/content');
    adoptEnvelope(result, !dirty());
    notify('Published. Your live portfolio is up to date.');
  } catch (error) { notify(error.message, true); }
  finally { state.saving = false; updateSaveState(); updateConflictNotice(); if (state.tab === 'media' && state.session?.authenticated) renderShell(); }
}
async function discardDraft() {
  if (!confirm('Discard all unpublished changes and restore the currently published content? This cannot be undone.')) return;
  if (state.saving) return;
  state.saving = true;
  updateSaveState();
  try {
    let result = await api('/api/admin/discard', { method: 'POST', body: { revision: state.revision } });
    if (!result.draft) result = await api('/api/admin/content');
    adoptEnvelope(result);
    renderShell();
    notify('Draft restored to the published version.');
  } catch (error) { notify(error.message, true); }
  finally { state.saving = false; updateSaveState(); }
}
function updateSaveState() {
  const unsaved = dirty();
  const unpublished = state.savedJSON !== state.publishedJSON;
  document.querySelectorAll('[data-save-state]').forEach(node => {
    node.className = `save-state ${unsaved ? 'unsaved' : unpublished ? '' : 'current'}`;
    node.replaceChildren(el('span', { class: 'dot' }), state.saving ? 'Saving…' : unsaved ? 'Unsaved edits' : unpublished ? 'Draft saved' : 'Published');
  });
  document.querySelectorAll('[data-save]').forEach(node => { node.disabled = state.saving || !unsaved; });
  document.querySelectorAll('[data-publish]').forEach(node => { node.disabled = state.saving || (!unsaved && !unpublished); });
  document.querySelectorAll('[data-publish-meta]').forEach(node => { node.textContent = `Last published ${dateLabel(state.publishedAt)} · Draft saved ${dateLabel(state.updatedAt)}`; });
  document.querySelectorAll('[data-preview-note]').forEach(node => {
    node.classList.toggle('dirty-preview', unsaved);
    node.textContent = unsaved ? 'Preview shows the saved draft. Refresh preview to save and see your changes.' : 'Private preview of your saved draft. The live site changes only when you publish.';
  });
}
function updateConflictNotice() {
  const container = document.querySelector('#conflict-notice');
  if (!container) return;
  container.hidden = !state.conflict;
  container.replaceChildren(el('p', {}, 'This draft changed in another session. Your edits are still here. Reload the latest draft before saving again.'),
    button('Reload latest draft', async () => {
      if (dirty() && !confirm('Reloading will replace unsaved edits in this tab with the latest saved draft. Continue?')) return;
      try { await loadContent(); } catch (error) { notify(error.message, true); }
    }, 'small'));
}
async function logout() {
  if (dirty() && !confirm('You have unsaved edits. Sign out and discard them?')) return;
  try {
    await api('/api/logout', { method: 'POST', body: {} });
    state.document = null;
    state.savedJSON = '';
    state.media = [];
    state.mediaLoaded = false;
    state.session = { configured: true, authenticated: false };
    renderLogin();
  } catch (error) { notify(error.message, true); }
}
function renderLogin(message = '') {
  const configured = state.session?.configured;
  const content = el('section', { class: 'auth-card' },
    el('div', { class: 'brand-mark', 'aria-label': 'Farhan Galib' }, 'fg', el('span', {}, '.')),
    el('h1', {}, configured ? 'Your portfolio, behind the scenes.' : 'Set up your console.'),
    el('p', {}, configured ? 'Sign in to shape your page, manage your work, and make it yours.' : 'Create your administrator account from the terminal on the server running this portfolio.'));
  if (!configured) {
    content.append(el('div', { class: 'stack' },
      el('code', {}, 'npm run admin:setup'),
      el('p', { class: 'field-help' }, 'Choose your own email and password. Then return here and refresh. There is no public sign-up or default password.'),
      button('Check setup', () => initialize(), 'primary')));
  } else {
    const errorNode = el('p', { class: 'form-error', role: 'alert', hidden: !message }, message);
    let email = state.session?.email || '';
    let password = '';
    const submit = el('button', { class: 'btn primary', type: 'submit' }, 'Sign in');
    const form = el('form', { onSubmit: async event => {
      event.preventDefault();
      submit.disabled = true;
      submit.textContent = 'Signing in…';
      errorNode.hidden = true;
      try {
        await api('/api/login', { method: 'POST', body: { email: email.trim(), password } });
        state.session = await api('/api/session');
        await loadContent(true);
      } catch (error) {
        errorNode.textContent = error.message;
        errorNode.hidden = false;
        submit.disabled = false;
        submit.textContent = 'Sign in';
      }
    } },
    field('Email address', email, value => { email = value; }, { type: 'email', required: true, autocomplete: 'username' }),
    field('Password', '', value => { password = value; }, { type: 'password', required: true, autocomplete: 'current-password' }),
    errorNode, submit);
    content.append(form);
  }
  content.append(el('a', { href: '/', class: 'auth-back' }, 'View portfolio'));
  app.replaceChildren(el('main', { class: 'auth-wrap', id: 'main' }, content));
}
function navigate(tab) {
  state.tab = tab;
  history.replaceState(null, '', `#${tab}`);
  renderShell();
  document.querySelector('#main h1')?.focus({ preventScroll: true });
}
function renderShell() {
  if (!state.session?.authenticated || !state.document) return;
  previewObserver?.disconnect();
  const sidebar = el('aside', { class: 'sidebar' },
    el('div', { class: 'sidebar-brand' }, el('a', { href: '/', class: 'brand-mark', 'aria-label': 'View portfolio' }, 'fg', el('span', {}, '.')), el('div', {}, el('strong', {}, 'Portfolio Console'), el('small', {}, 'Your creative workspace'))),
    el('nav', { 'aria-label': 'Console navigation' }, tabs.map(tab => el('button', { type: 'button', class: 'nav-button', title: tabNames[tab], 'aria-label': tabNames[tab], 'aria-current': state.tab === tab ? 'page' : undefined, onClick: () => navigate(tab) }, icon(tab), el('span', {}, tabNames[tab])))),
    el('div', { class: 'sidebar-bottom' }, el('a', { href: '/', target: '_blank', rel: 'noopener' }, 'View live portfolio'), el('div', { class: 'sidebar-account' }, el('span', { class: 'email' }, state.session.email), el('button', { type: 'button', onClick: logout }, 'Sign out'))));
  const topbar = el('header', { class: 'topbar' },
    el('div', { class: 'workspace-context' }, el('strong', {}, 'Make a little change. Make it yours.'), el('p', {}, 'Your edits stay private until you publish.')),
    el('div', { class: 'button-row' }, el('span', { 'data-save-state': '', class: 'save-state', role: 'status' }),
      button('Save draft', () => saveDraft(), '', { 'data-save': '' }), button('Publish changes', publish, 'primary', { 'data-publish': '' })));
  const body = el('main', { class: 'workspace-body', id: 'main' }, el('div', { class: 'notice warning', id: 'conflict-notice', hidden: true }));
  const screen = { builder: renderBuilder, content: renderContent, projects: renderProjects, media: renderMedia, account: renderAccount }[state.tab]();
  body.append(screen);
  body.querySelector('h1')?.setAttribute('tabindex', '-1');
  app.replaceChildren(el('div', { class: 'shell' }, sidebar, el('div', { class: 'workspace' }, topbar, body)));
  updateSaveState();
  updateConflictNotice();
}

function moveSection(id, delta) {
  const sections = state.document.sections;
  const index = sections.findIndex(section => section.id === id);
  const target = index + delta;
  if (target < 0 || target >= sections.length) return;
  [sections[index], sections[target]] = [sections[target], sections[index]];
  markChanged();
  renderShell();
}
function setSectionVisible(section, visible) {
  if (!visible && state.document.sections.filter(item => item.visible).length <= 1) {
    notify('Keep at least one section visible.', true);
    renderShell();
    return;
  }
  changed(section, 'visible', visible);
  renderShell();
}
function addSection(kind) {
  if (state.document.sections.length >= 40) return notify('A page can contain up to 40 sections.', true);
  const section = { id: `custom-${crypto.randomUUID().slice(0, 8)}`, kind, label: `New ${kind} section`, visible: true, spacing: 'comfortable', title: '', body: '' };
  if (kind === 'image') Object.assign(section, { image: '', imageAlt: '' });
  if (kind === 'cta') Object.assign(section, { linkLabel: '', linkUrl: '' });
  state.document.sections.push(section);
  state.section = section.id;
  markChanged();
  renderShell();
}
function customSectionEditor(section) {
  const wrapper = el('div', { class: 'stack custom-editor' },
    field('Section label (in console)', section.label, value => changed(section, 'label', value), { maxlength: 120 }),
    field('Heading', section.title, value => changed(section, 'title', value), { maxlength: 300 }),
    field('Body', section.body, value => changed(section, 'body', value), { multiline: true, maxlength: 10000 }));
  if (section.kind === 'image') {
    const render = () => {
      imageHolder.replaceChildren(imageField('Section image', section.image, value => { changed(section, 'image', value); render(); }, {
        alt: section.imageAlt, onAlt: value => changed(section, 'imageAlt', value),
      }));
    };
    const imageHolder = el('div');
    render();
    wrapper.append(imageHolder);
  }
  if (section.kind === 'cta') wrapper.append(
    field('Button label', section.linkLabel, value => changed(section, 'linkLabel', value), { maxlength: 100 }),
    field('Button link', section.linkUrl, value => changed(section, 'linkUrl', value), { placeholder: 'https://… or mailto:…', maxlength: 2000 }));
  return wrapper;
}
function renderBuilder() {
  const sections = state.document.sections;
  const selected = sections.find(section => section.id === state.section) || sections[0];
  const list = el('div', { class: 'section-list', 'aria-label': 'Page sections' });
  sections.forEach(section => {
    const row = el('div', { class: `section-row${section.id === selected?.id ? ' active' : ''}${section.visible ? '' : ' invisible'}`, draggable: 'true', 'data-section-id': section.id,
      onDragstart: event => { event.dataTransfer.setData('text/plain', section.id); event.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging'); },
      onDragend: () => { row.classList.remove('dragging'); document.querySelectorAll('.drag-over').forEach(item => item.classList.remove('drag-over')); },
      onDragover: event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; row.classList.add('drag-over'); },
      onDragleave: () => row.classList.remove('drag-over'),
      onDrop: event => {
        event.preventDefault();
        const from = sections.findIndex(item => item.id === event.dataTransfer.getData('text/plain'));
        const to = sections.findIndex(item => item.id === section.id);
        if (from < 0 || from === to) { row.classList.remove('drag-over'); return; }
        const [moving] = sections.splice(from, 1);
        sections.splice(to, 0, moving);
        state.section = moving.id;
        markChanged(); renderShell();
      },
    }, el('button', { type: 'button', class: 'section-select', 'aria-pressed': selected?.id === section.id, onClick: () => { state.section = section.id; renderShell(); } }, el('span', { class: 'section-symbol', 'aria-hidden': 'true' }, '⠿'), el('span', {}, section.label)),
    el('button', { type: 'button', class: 'visibility', title: section.visible ? 'Hide section' : 'Show section', 'aria-label': `${section.visible ? 'Hide' : 'Show'} ${section.label}`, 'aria-pressed': section.visible, onClick: () => setSectionVisible(section, !section.visible) }, icon(section.visible ? 'visible' : 'hidden')));
    list.append(row);
  });
  const addMenu = el('div', { class: 'add-section-menu', hidden: true }, ['text', 'image', 'cta'].map(kind => el('button', { type: 'button', onClick: () => addSection(kind) }, { text: 'Text', image: 'Image', cta: 'Call to action' }[kind])));
  const listPanel = el('section', { class: 'panel' }, el('div', { class: 'panel-heading' }, el('div', {}, el('h2', {}, 'Your page'), el('p', {}, 'Drag to reorder. Select to refine.')), el('span', { class: 'badge' }, `${sections.length} sections`)), list,
    el('div', { class: 'section-list-bottom' }, el('span', {}, `${sections.filter(section => section.visible).length} visible`), button('Add section', () => { addMenu.hidden = !addMenu.hidden; }, 'small')), addMenu);
  const selectedIndex = sections.indexOf(selected);
  const properties = el('section', { class: 'panel section-properties' }, el('h3', {}, selected?.label || 'Section settings'));
  if (selected) {
    properties.append(checkField('Visible on the page', selected.visible, value => setSectionVisible(selected, value)),
      selectField('Section spacing', selected.spacing || 'comfortable', ['comfortable', 'compact'], value => changed(selected, 'spacing', value)),
      el('div', { class: 'button-row section-order' }, button('Move up', () => moveSection(selected.id, -1), 'small', { disabled: selectedIndex === 0 }), button('Move down', () => moveSection(selected.id, 1), 'small', { disabled: selectedIndex === sections.length - 1 })));
    if (selected.kind === 'builtin') properties.append(button('Edit section content', () => { state.contentSection = selected.id; navigate('content'); }, 'small section-remove'));
    else {
      properties.append(customSectionEditor(selected), button('Delete section', () => {
        if (!confirm(`Delete “${selected.label}” from the draft?`)) return;
        if (selected.visible && sections.filter(section => section.visible).length <= 1) return notify('Keep at least one section visible.', true);
        state.document.sections = sections.filter(section => section.id !== selected.id);
        state.section = state.document.sections[0]?.id;
        markChanged(); renderShell();
      }, 'small danger section-remove'));
    }
  }
  const previewFrame = el('iframe', { title: 'Private portfolio draft preview', src: `/?preview=1&consoleVersion=${previewVersion}`, loading: 'lazy' });
  const previewStage = el('div', { class: 'preview-stage' }, previewFrame);
  const viewport = el('div', { class: 'preview-viewport', 'data-size': state.previewSize }, previewStage);
  const fitPreview = () => {
    const dimensions = { desktop: [1440, 960], tablet: [768, 1024], phone: [390, 844] };
    const [width, height] = dimensions[state.previewSize];
    const availableWidth = Math.max(100, viewport.clientWidth - 32);
    const scale = Math.min(1, availableWidth / width);
    previewStage.style.width = `${width * scale}px`;
    previewStage.style.height = `${height * scale}px`;
    previewFrame.style.width = `${width}px`;
    previewFrame.style.height = `${height}px`;
    previewFrame.style.transform = `scale(${scale})`;
    viewport.style.height = `${height * scale + 40}px`;
  };
  previewObserver = new ResizeObserver(fitPreview);
  previewObserver.observe(viewport);
  const segmented = el('div', { class: 'segmented', 'aria-label': 'Preview size' });
  ['desktop', 'tablet', 'phone'].forEach(size => segmented.append(el('button', { type: 'button', 'aria-pressed': size === state.previewSize, onClick: event => {
    state.previewSize = size;
    viewport.dataset.size = size;
    fitPreview();
    segmented.querySelectorAll('button').forEach(node => node.setAttribute('aria-pressed', String(node === event.currentTarget)));
  } }, size[0].toUpperCase() + size.slice(1))));
  const preview = el('section', { class: 'panel preview-panel', 'aria-label': 'Page preview' },
    el('div', { class: 'preview-toolbar' }, segmented, el('span', { class: 'preview-info' }, 'Draft preview'), button('Refresh preview', async event => {
      const target = event.currentTarget;
      target.disabled = true;
      if (await saveDraft({ quiet: true })) { previewVersion += 1; viewport.querySelector('iframe').src = `/?preview=1&consoleVersion=${previewVersion}`; }
      target.disabled = false;
    }, 'small')),
    viewport, el('p', { class: 'preview-footnote', 'data-preview-note': '' }));
  return el('div', {}, heading('A page that feels like you.', 'Arrange your story, refine each section, and preview it before it goes live.'),
    el('div', { class: 'builder-grid' }, el('div', { class: 'builder-controls' }, listPanel, properties), preview));
}

function imageField(label, src, onChange, options = {}) {
  const actions = el('div', { class: 'button-row' }, button(src ? 'Replace image' : 'Choose image', () => openMediaPicker(onChange), 'small'), src ? button('Remove', () => onChange(''), 'small text') : null);
  return el('div', { class: 'field' }, el('span', { class: 'field-label' }, label),
    el('div', { class: 'image-field' }, el('div', { class: 'image-thumb' }, thumbnail(src)), el('div', { class: 'image-field-controls' }, actions,
      src ? el('p', { class: 'path' }, src.split('/').pop()) : el('p', { class: 'field-help' }, 'Choose an existing image or upload your own.'),
      options.onAlt ? field('Image description (alt text)', options.alt || '', options.onAlt, { maxlength: 500, placeholder: 'Describe what this image shows' }) : null,
      options.onFit ? selectField('Image display', options.fit || 'original', [{ value: 'original', label: 'Original art direction' }, { value: 'contain', label: 'Fit entire image' }, { value: 'cover', label: 'Fill and crop' }], options.onFit) : null)));
}
function renderContent() {
  const groups = [{ id: 'settings', label: 'Site settings' }, ...state.document.sections];
  if (!groups.some(group => group.id === state.contentSection)) state.contentSection = 'settings';
  const menu = el('nav', { class: 'panel content-sections', 'aria-label': 'Content sections' }, groups.map(group => el('button', { type: 'button', 'aria-current': group.id === state.contentSection, onClick: () => { state.contentSection = group.id; renderShell(); } }, group.label, group.id !== 'settings' ? el('small', {}, group.kind === 'builtin' ? state.document.fields.filter(item => item.section === group.id).length : 'Custom') : null)));
  const selected = groups.find(group => group.id === state.contentSection);
  const fieldsArea = el('div', { class: 'content-fields' });
  const renderFields = (query = '') => {
    fieldsArea.replaceChildren();
    if (selected.id === 'settings') {
      const settings = state.document.settings;
      const fields = [
        ['name', 'Display name', 'text'], ['title', 'Page title', 'text'], ['description', 'Search description', 'text'],
        ['email', 'Contact email', 'email'], ['phone', 'Phone number', 'tel'],
        ['github', 'GitHub URL', 'url'], ['linkedin', 'LinkedIn URL', 'url'], ['medium', 'Medium URL', 'url'],
      ];
      const limits = { name: 120, title: 200, description: 1000, email: 254, phone: 40 };
      fieldsArea.append(...fields.filter(([, label]) => label.toLowerCase().includes(query)).map(([key, label, type]) => field(label, settings[key], value => changed(settings, key, value), { type, multiline: key === 'description', maxlength: limits[key] || 2000, required: ['email', 'title', 'name'].includes(key) })));
    } else if (selected.kind !== 'builtin') fieldsArea.append(customSectionEditor(selected));
    else {
      const fields = state.document.fields.filter(item => item.section === selected.id && `${item.label} ${item.value}`.toLowerCase().includes(query));
      fields.forEach(item => {
        if (item.type === 'image') {
          const holder = el('div');
          const refresh = () => holder.replaceChildren(imageField(item.label, item.value, value => { changed(item, 'value', value); refresh(); }, {
            alt: item.alt, onAlt: value => changed(item, 'alt', value), fit: item.fit, onFit: value => changed(item, 'fit', value),
          }));
          refresh(); fieldsArea.append(holder);
        } else fieldsArea.append(field(item.label, item.value, value => changed(item, 'value', value), {
          type: 'text', multiline: item.type === 'text' && (String(item.value).length > 100 || String(item.value).includes('\n') || /description|body|story|paragraph/i.test(item.label)),
          maxlength: item.type === 'url' ? 2000 : 10000,
          ...(item.type === 'url' ? { placeholder: 'https://…, mailto:…, tel:…, or #section' } : {}),
        }));
      });
      if (!fields.length) fieldsArea.append(el('div', { class: 'empty-state' }, 'No matching content fields.'));
    }
  };
  renderFields();
  const search = el('input', { type: 'search', placeholder: 'Find a field…', 'aria-label': 'Search content fields', onInput: event => renderFields(event.target.value.trim().toLowerCase()) });
  const contentPanel = panel(selected.label, selected.id === 'settings' ? 'Identity, contact details, and search appearance.' : 'Edit the words and images in this section.', [el('div', { class: 'toolbar' }, search), fieldsArea]);
  return el('div', {}, heading('Words, images, your story.', 'Manage everything visitors see, one section at a time.'), el('div', { class: 'content-layout' }, menu, contentPanel));
}

function newProject() {
  const project = {
    id: `project-${crypto.randomUUID().slice(0, 8)}`, name: 'Untitled project', category: 'Other', description: '', descriptionVerified: false,
    featured: false, icon: '', screenshots: [], links: { play: '', appStore: '', aci: '' }, linkStatuses: {},
    linkStatus: 'unverified', role: '', headline: '', summary: '', features: [], preview: [],
  };
  state.document.projects.push(project);
  state.project = project.id;
  markChanged(); renderShell();
}
function projectGallery(project) {
  const holder = el('div');
  const refresh = () => {
    holder.replaceChildren();
    const gallery = el('div', { class: 'gallery-grid' });
    (project.screenshots || []).forEach((src, index) => {
      const move = delta => {
        const target = index + delta;
        const selectedSources = (project.preview || []).map(value => project.screenshots[value - 1]);
        [project.screenshots[index], project.screenshots[target]] = [project.screenshots[target], project.screenshots[index]];
        project.preview = selectedSources.map(value => project.screenshots.indexOf(value) + 1).filter(value => value > 0);
        markChanged(); refresh();
      };
      gallery.append(el('div', { class: 'gallery-item' }, thumbnail(src, `${project.name} screenshot ${index + 1}`),
        checkField('Use in featured scene', (project.preview || []).includes(index + 1), checked => {
          project.preview ||= [];
          if (checked && project.preview.length >= 2) { notify('Choose up to two images for a featured scene.', true); refresh(); return; }
          project.preview = checked ? [...project.preview, index + 1] : project.preview.filter(value => value !== index + 1);
          markChanged();
        }),
        el('div', { class: 'button-row' }, button('Up', () => move(-1), 'small', { disabled: index === 0, 'aria-label': `Move screenshot ${index + 1} earlier` }), button('Down', () => move(1), 'small', { disabled: index === project.screenshots.length - 1, 'aria-label': `Move screenshot ${index + 1} later` })),
        el('div', { class: 'button-row' }, button('Replace', () => openMediaPicker(value => { project.screenshots[index] = value; markChanged(); refresh(); }), 'small'), button('Remove', () => {
          project.screenshots.splice(index, 1);
          project.preview = (project.preview || []).filter(value => value !== index + 1).map(value => value > index + 1 ? value - 1 : value);
          markChanged(); refresh();
        }, 'small text')), el('p', { class: 'path' }, src.split('/').pop())));
    });
    holder.append(gallery, button('Add screenshot', () => {
      if (project.screenshots.length >= 30) return notify('A project can have up to 30 screenshots.', true);
      openMediaPicker(value => { project.screenshots.push(value); markChanged(); refresh(); });
    }, 'small', { style: 'margin-top:16px' }));
  };
  refresh();
  return holder;
}
function renderProjectEditor(project) {
  if (!project) return el('div', { class: 'panel empty-state' }, el('h2', {}, 'Your next project starts here.'), el('p', {}, 'Add a project to build your portfolio.'), button('Add project', newProject, 'primary'));
  const iconHolder = el('div');
  const refreshIcon = () => iconHolder.replaceChildren(imageField('App icon', project.icon, value => { changed(project, 'icon', value); refreshIcon(); }));
  refreshIcon();
  const basic = panel('Project details', 'A clear introduction to the work.', [
    el('div', { class: 'field-grid' },
      field('Project name', project.name, value => { changed(project, 'name', value); updateProjectListName(project); }, { maxlength: 160 }),
      field('Category', project.category, value => changed(project, 'category', value), { maxlength: 100 }),
      field('Description', project.description, value => changed(project, 'description', value), { multiline: true, full: true, maxlength: 10000 }),
      field('Your role', project.role || '', value => changed(project, 'role', value), { full: true, maxlength: 1000 }),
      field('Download count or install band', project.downloads || '', value => changed(project, 'downloads', value), { placeholder: 'Only use verified information', maxlength: 100 }),
      selectField('Overall link status', project.linkStatus || 'unverified', ['available', 'unverified', 'coming-soon'], value => changed(project, 'linkStatus', value))),
    iconHolder,
  ]);
  const featured = panel('Featured presentation', 'Choose whether this project appears in the main work showcase.', [
    checkField('Feature this project', project.featured, value => {
      if (value && state.document.projects.filter(item => item.featured).length >= 12) { notify('Choose up to 12 featured projects.', true); renderShell(); return; }
      changed(project, 'featured', value); updateProjectListName(project);
    }),
    field('Featured headline', project.headline || '', value => changed(project, 'headline', value), { multiline: true, maxlength: 300, help: 'Use a line break for intentional headline pacing.' }),
    field('Featured summary', project.summary || '', value => changed(project, 'summary', value), { multiline: true, maxlength: 4000, help: 'A short introduction for the main showcase. The full description appears in project details.' }),
    field('Key features', (project.features || []).join('\n'), value => changed(project, 'features', value.split('\n').filter(line => line.trim()).map(line => line.trim())), { multiline: true, maxlength: 6000, help: 'One feature per line, up to 12. Use only details you can verify.' }),
  ]);
  const links = project.links ||= {};
  const statuses = project.linkStatuses ||= {};
  const storeLabels = { play: 'Google Play', appStore: 'App Store', aci: 'ACI listing', github: 'GitHub', website: 'Website' };
  const linksPanel = panel('Project links', 'Empty links stay hidden on the portfolio.', Object.entries(storeLabels).map(([key, label]) => el('div', { class: 'link-editor' },
    el('span', { class: 'field-label' }, label), field(`${label} URL`, links[key] || '', value => {
      links[key] = value;
      if (value && !statuses[key]) statuses[key] = 'unverified';
      if (!value) delete statuses[key];
      markChanged();
    }, { type: 'url', maxlength: 2000, placeholder: 'https://…' }),
    selectField(`${label} status`, statuses[key] || 'unverified', ['available', 'unverified', 'coming-soon'], value => { if (links[key]) changed(statuses, key, value); }))));
  const gallery = panel('Screenshots', 'Set the image order and select up to two images for the featured scene.', projectGallery(project));
  const projectIndex = state.document.projects.indexOf(project);
  const moveProject = delta => {
    const list = state.document.projects;
    [list[projectIndex], list[projectIndex + delta]] = [list[projectIndex + delta], list[projectIndex]];
    markChanged(); renderShell();
  };
  const footer = el('div', { class: 'panel panel-body stack' }, el('div', { class: 'button-row' },
    button('Move project up', () => moveProject(-1), 'small', { disabled: projectIndex === 0 }),
    button('Move project down', () => moveProject(1), 'small', { disabled: projectIndex === state.document.projects.length - 1 }),
    button('Delete project', () => {
      if (!confirm(`Delete “${project.name}” from the draft? Its image files will stay in the media library.`)) return;
      state.document.projects = state.document.projects.filter(item => item.id !== project.id);
      state.project = state.document.projects[0]?.id;
      markChanged(); renderShell();
    }, 'small danger')));
  const provenance = Object.entries(project).filter(([key]) => /Source$|sourceDate|descriptionVerified/.test(key));
  if (provenance.length) footer.append(el('details', { class: 'metadata' }, el('summary', {}, 'Source information'), el('p', {}, 'Original source notes are preserved when you edit this project.'), el('dl', {}, provenance.flatMap(([key, value]) => [el('dt', {}, key), el('dd', {}, String(value))]))));
  return el('div', { class: 'project-editor' }, basic, featured, linksPanel, gallery, footer);
}
function updateProjectListName(project) {
  const node = document.querySelector(`[data-project-name="${CSS.escape(project.id)}"]`);
  if (node) node.textContent = project.name;
  const meta = document.querySelector(`[data-project-meta="${CSS.escape(project.id)}"]`);
  if (meta) meta.textContent = `${project.category}${project.featured ? ' · Featured' : ''}`;
}
function renderProjects() {
  const list = el('div', { class: 'project-list' });
  const renderList = query => {
    list.replaceChildren();
    const projects = state.document.projects.filter(project => `${project.name} ${project.category}`.toLowerCase().includes(query));
    projects.forEach(project => list.append(el('button', { type: 'button', 'aria-current': project.id === state.project, onClick: () => { state.project = project.id; renderShell(); } },
      project.icon ? thumbnail(project.icon) : el('span', { class: 'project-fallback', 'aria-hidden': 'true' }, project.name.slice(0, 1)),
      el('div', {}, el('strong', { 'data-project-name': project.id }, project.name), el('small', { 'data-project-meta': project.id }, `${project.category}${project.featured ? ' · Featured' : ''}`)))));
    if (!projects.length) list.append(el('p', { class: 'empty-state' }, 'No matching projects.'));
  };
  renderList('');
  const selected = state.document.projects.find(project => project.id === state.project) || state.document.projects[0];
  if (selected) state.project = selected.id;
  const nav = el('section', { class: 'panel project-list-panel', 'aria-label': 'Projects' }, el('div', { class: 'project-search' }, el('input', { type: 'search', placeholder: 'Find a project…', 'aria-label': 'Search projects', onInput: event => renderList(event.target.value.trim().toLowerCase()) })), list);
  return el('div', {}, heading('Give your work its moment.', `${state.document.projects.length} projects · ${state.document.projects.filter(project => project.featured).length} featured in your portfolio`, button('Add project', newProject, 'primary')),
    el('div', { class: 'project-layout' }, nav, renderProjectEditor(selected)));
}

async function loadMedia() {
  state.mediaLoading = true;
  state.mediaError = '';
  try {
    const result = await api('/api/admin/media');
    state.media = result.items || [];
    state.mediaLoaded = true;
  } catch (error) { state.mediaError = error.message; throw error; }
  finally { state.mediaLoading = false; }
}
async function uploadMedia(file) {
  if (!file) return null;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, or WebP image.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Images must be 8 MB or smaller.');
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('This file could not be read. Please choose it again.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(file);
  });
  const result = await api('/api/admin/media', { method: 'POST', body: { name: file.name, data } });
  await loadMedia();
  notify('Image uploaded and ready to use.');
  return result.item;
}
function uploadControl(onUploaded) {
  const id = `upload-${crypto.randomUUID()}`;
  const input = el('input', { id, type: 'file', accept: 'image/png,image/jpeg,image/webp', onChange: async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    input.disabled = true;
    status.textContent = 'Uploading and optimizing…';
    try { const item = await uploadMedia(file); if (item) onUploaded(item); }
    catch (error) { notify(error.message, true); }
    finally { input.disabled = false; input.value = ''; status.textContent = 'PNG, JPEG, WebP · Up to 8 MB'; }
  } });
  const status = el('p', { role: 'status' }, 'PNG, JPEG, WebP · Up to 8 MB');
  return el('div', { class: 'upload-drop' }, el('div', {}, el('h2', {}, 'Bring a new image in.'), status), el('div', { class: 'field' }, el('label', { for: id, class: 'field-label' }, 'Upload image'), input));
}
function localMediaUsage(src) {
  if (!state.document) return false;
  return state.document.fields.some(field => field.type === 'image' && field.value === src)
    || state.document.sections.some(section => section.image === src)
    || state.document.projects.some(project => project.icon === src || project.screenshots?.includes(src));
}
function mediaCard(item, picker = false) {
  const used = Array.isArray(item.usedBy) ? item.usedBy : [];
  const usage = used.map(entry => typeof entry === 'string' ? entry : entry.label || entry.name || entry.id || 'Portfolio content');
  const image = thumbnail(item.src, item.name);
  const mediaImage = picker ? el('button', { type: 'button', class: 'media-image', 'aria-label': `Choose ${item.name}`, onClick: () => chooseMedia(item.src) }, image) : el('div', { class: 'media-image' }, image);
  const meta = el('div', { class: 'media-meta' }, el('strong', {}, item.name), el('p', {}, [item.width && item.height ? `${item.width} × ${item.height}` : '', fileSize(item.size)].filter(Boolean).join(' · ')),
    el('span', { class: 'badge' }, item.uploaded ? 'Uploaded' : 'Original asset'),
    !picker ? el('p', { class: 'media-usage' }, usage.length ? `Used in ${usage.length} place${usage.length === 1 ? '' : 's'}` : localMediaUsage(item.src) ? 'Used in unsaved draft' : 'Not currently used') : null);
  if (picker) meta.append(button('Use image', () => chooseMedia(item.src), 'small'));
  else if (item.uploaded) meta.append(button('Delete image', async () => {
    if (localMediaUsage(item.src)) return notify('Remove this image from the page and projects, then save and publish before deleting it.', true);
    if (!confirm(`Permanently delete “${item.name}” from the media library?`)) return;
    try {
      await api(`/api/admin/media/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      await loadMedia(); renderShell(); notify('Image removed from the media library.');
    } catch (error) { notify(error.message, true); }
  }, 'small danger', { disabled: used.length > 0, title: used.length ? 'Remove references from draft and published content before deleting this image.' : 'Delete unused uploaded image' }));
  return el('article', { class: `media-card${picker ? ' pickable' : ''}` }, mediaImage, meta);
}
function mediaBrowser(picker = false) {
  const cards = el('div', { class: 'media-grid' });
  const count = el('span', { class: 'badge' });
  let query = '';
  let kind = 'all';
  const update = () => {
    const items = state.media.filter(item => (kind === 'all' || (kind === 'uploaded' ? item.uploaded : !item.uploaded)) && `${item.name} ${item.src}`.toLowerCase().includes(query));
    count.textContent = `${items.length} image${items.length === 1 ? '' : 's'}`;
    cards.replaceChildren(...items.map(item => mediaCard(item, picker)));
    if (!items.length) cards.append(el('div', { class: 'empty-state' }, 'No matching images.'));
  };
  const browser = el('div', {}, uploadControl(item => {
    if (picker) chooseMedia(item.src);
    else update();
  }),
  el('div', { class: 'toolbar' }, el('input', { type: 'search', placeholder: 'Search images…', 'aria-label': 'Search media library', onInput: event => { query = event.target.value.trim().toLowerCase(); update(); } }),
    el('select', { 'aria-label': 'Filter image source', onChange: event => { kind = event.target.value; update(); } }, el('option', { value: 'all' }, 'All images'), el('option', { value: 'uploaded' }, 'Your uploads'), el('option', { value: 'original' }, 'Original assets')), count), cards);
  update();
  return browser;
}
function renderMedia() {
  const content = el('div');
  const render = () => {
    if (state.mediaError) content.replaceChildren(el('div', { class: 'notice error' }, el('p', {}, state.mediaError), button('Try again', async () => { try { await loadMedia(); render(); } catch { render(); } }, 'small')));
    else content.replaceChildren(mediaBrowser());
  };
  if (!state.mediaLoaded) {
    content.append(el('p', { class: 'loading', role: 'status' }, 'Loading your images…'));
    loadMedia().then(render).catch(render);
  } else render();
  return el('div', {}, heading('Your image library.', 'Upload, replace, or remove images. Original assets remain available; unused uploads can be deleted.'), content);
}
function chooseMedia(src) {
  const callback = mediaPicker;
  mediaPicker = null;
  mediaDialog.close();
  callback?.(src);
}
async function openMediaPicker(callback) {
  mediaPicker = callback;
  const body = el('div', { class: 'dialog-body' }, el('p', { class: 'loading', role: 'status' }, 'Loading images…'));
  mediaDialog.replaceChildren(el('div', { class: 'dialog-header' }, el('div', {}, el('h2', { id: 'media-dialog-title' }, 'Find the right image.'), el('p', {}, 'Choose from your library, or upload something new.')), button('Close', () => mediaDialog.close(), 'small')), body);
  mediaDialog.showModal();
  try { await loadMedia(); if (mediaDialog.open) body.replaceChildren(mediaBrowser(true)); }
  catch (error) { body.replaceChildren(el('p', { class: 'notice error', role: 'alert' }, error.message)); }
}
mediaDialog.addEventListener('close', () => { mediaPicker = null; });

function renderAccount() {
  const errorNode = el('p', { class: 'form-error', role: 'alert', hidden: true });
  let currentPassword = '';
  let newPassword = '';
  let confirmation = '';
  const submit = el('button', { type: 'submit', class: 'btn primary' }, 'Update password');
  const form = el('form', { onSubmit: async event => {
    event.preventDefault();
    errorNode.hidden = true;
    if (newPassword !== confirmation) { errorNode.textContent = 'The new passwords do not match.'; errorNode.hidden = false; return; }
    if (newPassword.length < 12) { errorNode.textContent = 'Use a password with at least 12 characters.'; errorNode.hidden = false; return; }
    submit.disabled = true;
    try {
      await api('/api/password', { method: 'POST', body: { currentPassword, newPassword } });
      state.session = await api('/api/session');
      form.reset(); currentPassword = ''; newPassword = ''; confirmation = '';
      notify('Password updated.');
    } catch (error) { errorNode.textContent = error.message; errorNode.hidden = false; }
    finally { submit.disabled = false; }
  } },
    field('Current password', '', value => { currentPassword = value; }, { type: 'password', required: true, autocomplete: 'current-password' }),
    field('New password', '', value => { newPassword = value; }, { type: 'password', required: true, minlength: 12, autocomplete: 'new-password', help: 'Use at least 12 characters. A unique passphrase works well.' }),
    field('Confirm new password', '', value => { confirmation = value; }, { type: 'password', required: true, minlength: 12, autocomplete: 'new-password' }), errorNode, submit);
  const accountFacts = el('dl', { class: 'account-facts' },
    el('div', {}, el('dt', {}, 'Signed in as'), el('dd', {}, state.session.email || 'Administrator')),
    el('div', {}, el('dt', {}, 'Last published'), el('dd', {}, dateLabel(state.publishedAt))),
    el('div', {}, el('dt', {}, 'Draft saved'), el('dd', {}, dateLabel(state.updatedAt))));
  return el('div', {}, heading('Your private workspace.', 'Manage access and keep your portfolio in your hands.'), el('div', { class: 'account-grid' },
    panel('Change password', 'Only you should have access to this console.', form),
    el('div', { class: 'stack' }, panel('Account & publishing', '', [accountFacts,
      el('div', { class: 'button-row' }, el('a', { class: 'btn small', href: '/', target: '_blank', rel: 'noopener' }, 'View live portfolio'), button('Sign out', logout, 'small'))]),
    panel('Draft controls', 'Restore the published version if you want to start again.', [el('p', { class: 'field-help' }, 'Discarding removes every unpublished content change. Uploaded image files stay in your library.'), button('Discard unpublished changes', discardDraft, 'small danger'), el('p', { class: 'publish-meta', 'data-publish-meta': '' })]))));
}
async function initialize() {
  try {
    state.session = await api('/api/session');
    if (state.session.authenticated) await loadContent();
    else renderLogin();
  } catch (error) {
    app.replaceChildren(el('main', { class: 'auth-wrap', id: 'main' }, el('section', { class: 'auth-card' }, el('h1', {}, 'Console unavailable.'), el('p', {}, 'Start the portfolio server with npm run dev, then open /admin/ on that server.'), el('p', { class: 'form-error', role: 'alert' }, error.message), button('Try again', initialize, 'primary'))));
  }
}
window.addEventListener('beforeunload', event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && state.session?.authenticated) { event.preventDefault(); saveDraft(); }
});
window.addEventListener('hashchange', () => { const tab = location.hash.slice(1); if (tabs.includes(tab) && state.session?.authenticated) { state.tab = tab; renderShell(); } });
initialize();
