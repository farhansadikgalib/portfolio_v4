// Shared trust boundary: only known content shapes and safe destinations reach disk.
const BUILTINS = new Set(['home','work-intro','work','approach','about','craft','experience','contact']);
const RESERVED = new Set(['main','year','mobile-nav','hero-title','work-title','about-title','craft-title','experience-title','contact-title','featured-projects','project-dialog','project-detail','archive-dialog','archive-title','archive-meta','archive-preview','project-search','archive-filters','results-count','archive-grid','dialog-title']);
const STATUS = ['available','unverified','coming-soon'];
function invalid(message) { const error = new Error(message); error.status = 400; error.statusCode = 400; throw error; }
function object(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object.`); return value; }
function text(value, label, max = 10000, required = false) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) invalid(`${label} must be text of at most ${max} characters.`);
  if (required && !value.trim()) invalid(`${label} is required.`);
  return value;
}
function array(value, label, max) { if (!Array.isArray(value) || value.length > max) invalid(`${label} must contain at most ${max} items.`); return value; }
function id(value, label) { if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(value)) invalid(`${label} must use lowercase letters, numbers, and hyphens.`); return value; }
function choice(value, values, label, fallback) { if (value === undefined && fallback !== undefined) return fallback; if (!values.includes(value)) invalid(`${label} is invalid.`); return value; }
function boolean(value, label) { if (typeof value !== 'boolean') invalid(`${label} must be true or false.`); return value; }
function unique(items, label) { if (new Set(items).size !== items.length) invalid(`${label} must be unique.`); }
export function mediaPath(value, label = 'Image') {
  text(value, label, 500);
  if (!value) return '';
  if (!/^\/?(?:assets\/[a-zA-Z0-9_/-]+\.(?:png|jpe?g|webp)|uploads\/[a-zA-Z0-9-]+\.webp)$/.test(value) || value.includes('..')) invalid(`${label} must be an image from the media library.`);
  return value;
}
function link(value, label, webOnly = false) {
  text(value, label, 2000);
  if (!value) return '';
  if (/\s|[<>"'`\\]/.test(value)) invalid(`${label} contains invalid URL characters.`);
  if (!webOnly && (/^#[a-z][a-z0-9-]*$/.test(value) || /^\/?farhan_resume\.pdf$/.test(value) || /^mailto:[^@?]+@[^@?]+(?:\?[^\s]*)?$/.test(value) || /^tel:\+?[\d().-]+$/.test(value))) return value;
  let parsed; try { parsed = new URL(value); } catch { invalid(`${label} must be a valid URL.`); }
  if (!['https:','http:'].includes(parsed.protocol) || parsed.username || parsed.password) invalid(`${label} must use HTTPS or HTTP without embedded credentials.`);
  return value;
}

export function validateDocument(input) {
  object(input, 'Content');
  if (input.schemaVersion !== 1) invalid('Unsupported content version.');
  const settings = object(input.settings, 'Settings');
  const email = text(settings.email, 'Contact email', 254, true);
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) invalid('Enter a valid contact email address.');
  const phone = text(settings.phone, 'Phone', 40);
  if (phone && !/^\+?[\d\s().-]+$/.test(phone)) invalid('Enter a valid phone number.');
  const sections = array(input.sections, 'Sections', 40).map(raw => {
    const item = object(raw, 'Section'), sectionId = id(item.id, 'Section ID');
    const kind = choice(item.kind, ['builtin','text','image','cta'], 'Section type');
    if ((kind === 'builtin') !== BUILTINS.has(sectionId) || RESERVED.has(sectionId)) invalid('Section ID conflicts with the page structure.');
    if (kind !== 'builtin' && !sectionId.startsWith('custom-')) invalid('Custom section IDs must start with custom-.');
    const result = { id: sectionId, label: text(item.label, 'Section label', 120, true), kind, visible: boolean(item.visible, 'Section visibility'), spacing: choice(item.spacing, ['comfortable','compact'], 'Section spacing') };
    if (kind !== 'builtin') Object.assign(result, {
      title: text(item.title ?? '', 'Section title', 300), body: text(item.body ?? '', 'Section body', 12000),
      image: mediaPath(item.image ?? ''), imageAlt: text(item.imageAlt ?? '', 'Image description', 500),
      linkLabel: text(item.linkLabel ?? '', 'Button label', 100), linkUrl: link(item.linkUrl ?? '', 'Button link'),
    });
    return result;
  });
  unique(sections.map(s => s.id), 'Section IDs');
  if ([...BUILTINS].some(key => !sections.some(s => s.id === key))) invalid('Built-in sections can be hidden but must remain in the page builder.');
  if (!sections.some(s => s.visible)) invalid('Keep at least one section visible.');
  const fields = array(input.fields, 'Content fields', 600).map(raw => {
    const field = object(raw, 'Content field');
    const type = choice(field.type, ['text','url','image'], 'Field type');
    if (!BUILTINS.has(field.section)) invalid('Content field section is invalid.');
    const result = { id: id(field.id, 'Field ID'), section: field.section, label: text(field.label, 'Field label', 160, true), type,
      value: type === 'image' ? mediaPath(field.value) : type === 'url' ? link(field.value, 'Link') : text(field.value, 'Content text', 12000) };
    if (type === 'image') Object.assign(result, { alt: text(field.alt ?? '', 'Image description', 500), fit: choice(field.fit, ['original','contain','cover'], 'Image fit', 'contain') });
    return result;
  });
  unique(fields.map(f => f.id), 'Field IDs');
  const projects = array(input.projects, 'Projects', 200).map(raw => {
    const project = object(raw, 'Project');
    const links = object(project.links, 'Project links'), statuses = object(project.linkStatuses, 'Store statuses');
    const result = {
      id: id(project.id, 'Project ID'), name: text(project.name, 'Project name', 160, true),
      category: text(project.category, 'Project category', 100, true),
      description: text(project.description ?? '', 'Project description', 12000),
      descriptionVerified: boolean(project.descriptionVerified ?? false, 'Description verified'),
      featured: boolean(project.featured, 'Featured project'), icon: mediaPath(project.icon ?? '', 'App icon'),
      screenshots: array(project.screenshots, 'Project screenshots', 30).map(src => mediaPath(src, 'Project screenshot')).filter(Boolean),
      headline: text(project.headline ?? project.name, 'Featured headline', 300),
      summary: text(project.summary ?? project.description ?? '', 'Featured summary', 5000),
      features: array(project.features ?? [], 'Project features', 12).map(value => text(value, 'Feature', 200)),
      preview: array(project.preview ?? [1,2], 'Preview positions', 2).map(value => { if (!Number.isInteger(value) || value < 1 || value > 30) invalid('Preview positions must be between 1 and 30.'); return value; }),
      role: text(project.role ?? '', 'Project role', 1000),
      links: {}, linkStatuses: {}, linkStatus: choice(project.linkStatus, STATUS, 'Project store status', 'unverified'),
    };
    for (const store of ['play','appStore','aci','github','website']) {
      result.links[store] = link(links[store] ?? '', `${store} link`, true);
      if (result.links[store]) result.linkStatuses[store] = choice(statuses[store], STATUS, `${store} availability`, 'unverified');
    }
    for (const key of ['roleSource','downloads','downloadsSource','sourceDate']) if (project[key] !== undefined) result[key] = text(project[key], key, 1000);
    return result;
  });
  unique(projects.map(p => p.id), 'Project IDs');
  if (projects.filter(p => p.featured).length > 12) invalid('Feature at most 12 projects to keep the showcase manageable.');
  const hasWork = projects.some(p => p.featured) && sections.some(s => s.id === 'work' && s.visible);
  if (!sections.some(s => s.visible && (!['work','work-intro'].includes(s.id) || hasWork))) invalid('Keep at least one section with visible content enabled. An empty project showcase cannot be the only visible section.');
  return { schemaVersion: 1, settings: { name: text(settings.name ?? 'Farhan Sadik Galib', 'Display name', 120, true), title: text(settings.title, 'Page title', 200, true), description: text(settings.description, 'Search description', 1000), email, phone, github: link(settings.github ?? '', 'GitHub', true), linkedin: link(settings.linkedin ?? '', 'LinkedIn', true), medium: link(settings.medium ?? '', 'Medium', true) }, sections, fields, projects };
}
