// One-time migration of the supplied portfolio into editable, plain-text fields.
// Existing annotations make subsequent runs stable. Do not run to reset live CMS data.
import { readFile, writeFile } from 'node:fs/promises';
import { load } from 'cheerio';
import { projects } from '../data/projects.js';

const source = await readFile('index.html', 'utf8');
const $ = load(source, { decodeEntities: false });
$('.work-intro').attr('id', 'work-intro');
$('.manifesto').attr('id', 'approach');
const labels = { home: 'Introduction', 'work-intro': 'Work introduction', work: 'Featured projects', approach: 'Approach', about: 'About', craft: 'Skills & open source', experience: 'Experience & education', contact: 'Contact' };
const sections = Object.entries(labels).map(([id, label]) => ({ id, label, kind: 'builtin', visible: true, spacing: 'comfortable' }));
const fields = [];
const globalLink = href => /^(?:mailto:|tel:|https:\/\/(?:github\.com|linkedin\.com\/in|medium\.com\/@)\/??farhansadikgalib)/.test(href);
for (const section of sections) {
  const root = $(`#${section.id}`);
  let textIndex = 0, linkIndex = 0, imageIndex = 0;
  function walk(node) {
    if (node.type === 'text') {
      const text = node.data.trim();
      if (!/[\p{L}\p{N}]/u.test(text) || text === 'farhansadikgalib@gmail.com') return;
      const parent = $(node.parent);
      if (parent.closest('script,style,svg,noscript,[aria-hidden="true"],[data-open-archive],.project-selector,.email-line').length) return;
      const id = `${section.id}-text-${++textIndex}`;
      const parentTag = node.parent.name;
      const prefix = /^h[1-6]$/.test(parentTag) ? 'Heading' : parent.closest('a,button,summary').length ? 'Label' : 'Text';
      fields.push({ id, section: section.id, label: `${prefix} · ${text.slice(0,70)}`, type: 'text', value: text });
      if (parent.is('cms-text')) { parent.attr('data-cms-text', id); return; }
      const leading = node.data.match(/^\s*/)[0], trailing = node.data.match(/\s*$/)[0];
      const wrapper = $('<cms-text></cms-text>').attr('data-cms-text', id).text(text);
      $(node).replaceWith(wrapper);
      if (leading) wrapper.before(leading);
      if (trailing) wrapper.after(trailing);
      return;
    }
    for (const child of [...(node.children || [])]) walk(child);
  }
  walk(root[0]);
  root.find('a[href]').each((_, element) => {
    const el = $(element), href = el.attr('href');
    if (el.closest('noscript').length || globalLink(href) || href.startsWith('#')) return;
    const id = `${section.id}-link-${++linkIndex}`;
    el.attr('data-cms-link', id);
    fields.push({ id, section: section.id, label: `Link · ${el.text().trim().slice(0,65)}`, type: 'url', value: href });
  });
  root.find('img').each((_, element) => {
    const el = $(element), id = `${section.id}-image-${++imageIndex}`;
    el.attr('data-cms-image', id);
    fields.push({ id, section: section.id, label: imageIndex === 1 ? 'Primary app image' : 'Companion app image', type: 'image', value: el.attr('src'), alt: el.attr('alt') || '', fit: 'original' });
  });
}
const stories = {
  cartup: { headline: 'Everyday finds.\nExtraordinary ease.', description: 'A marketplace made for Bangladesh. From discovering the right product to a secure checkout and tracking it all the way home.', features: ['Product discovery','Secure checkout','Order tracking'], preview: [1,3] },
  firsttrip: { headline: 'Next stop.\nAnywhere.', description: 'Flights, stays, and new possibilities. A cross-platform travel experience that brings the whole journey together in one place.', features: ['Flights & hotels','Holiday packages','Visa assistance'], preview: [1,3] },
  yspark: { headline: 'Every ride.\nMore connected.', description: 'A companion for the Yamaha community. Keeping service, warranty, and the next adventure just a few taps away.', features: ['Digital warranty','Service booking','Rider community'], preview: [1,2] },
  medex: { headline: 'Clarity, when\nit matters.', description: 'A medicine reference for Bangladesh. Bringing detailed drug information, smart search, and bilingual content into a focused mobile experience.', features: ['Medicine index','Smart search','Bilingual content'], preview: [1,2] },
};
const document = {
  schemaVersion: 1,
  settings: { name: 'Farhan Sadik Galib', title: $('title').text(), description: $('meta[name="description"]').attr('content'), email: 'farhansadikgalib@gmail.com', phone: '+8801773076754', github: 'https://github.com/farhansadikgalib', linkedin: 'https://linkedin.com/in/farhansadikgalib', medium: 'https://medium.com/@farhansadikgalib' },
  sections, fields,
  projects: projects.map(project => ({ ...project, headline: stories[project.id]?.headline || project.name, summary: stories[project.id]?.description || project.description, features: stories[project.id]?.features || [], preview: stories[project.id]?.preview || [1,2] })),
};
await writeFile('index.html', $.html());
await writeFile('data/default-content.json', JSON.stringify(document, null, 2) + '\n');
console.log(`Seeded ${sections.length} sections, ${fields.length} editable fields, and ${projects.length} projects. Live CMS storage was not changed.`);
