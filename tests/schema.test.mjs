import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateDocument } from '../server/schema.mjs';

const seed = JSON.parse(await readFile(new URL('../data/default-content.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(seed);

test('provided portfolio passes the CMS boundary without losing projects or fields', () => {
  const result = validateDocument(clone());
  assert.equal(result.projects.length, 33);
  assert.equal(result.fields.length, seed.fields.length);
  assert.equal(result.sections.length, 8);
});

test('script URLs, remote images, traversal, and dangerous schemes cannot be persisted', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,hello', 'https://user:password@example.com']) {
    const doc = clone(); doc.projects[0].links.play = value;
    assert.throws(() => validateDocument(doc), { status: 400 });
  }
  for (const value of ['../../.cms-data/auth.json', '/uploads/../../auth.json', 'https://example.com/image.png', 'assets/projects/file.svg', '/uploads/%2e%2e/auth.webp']) {
    const doc = clone(); doc.projects[0].icon = value;
    assert.throws(() => validateDocument(doc), { status: 400 });
  }
});

test('content cannot introduce duplicate identifiers or overwrite structural page IDs', () => {
  const duplicate = clone(); duplicate.projects.push(duplicate.projects[0]);
  assert.throws(() => validateDocument(duplicate), { status: 400 });
  const section = clone(); section.sections.push({ id: 'main', kind: 'text', label: 'Text', visible: true, spacing: 'compact' });
  assert.throws(() => validateDocument(section), { status: 400 });
  const fields = clone(); fields.fields.push(fields.fields[0]);
  assert.throws(() => validateDocument(fields), { status: 400 });
});

test('bounded content rejects oversized strings, unbounded galleries, and invalid flags', () => {
  const oversized = clone(); oversized.projects[0].description = 'x'.repeat(12001);
  assert.throws(() => validateDocument(oversized), { status: 400 });
  const gallery = clone(); gallery.projects[0].screenshots = Array(31).fill('assets/projects/cartup-screen-1.webp');
  assert.throws(() => validateDocument(gallery), { status: 400 });
  const flags = clone(); flags.sections[0].visible = 'false';
  assert.throws(() => validateDocument(flags), { status: 400 });
});

test('page builder supports custom content, removal of images, and an empty project collection', () => {
  const doc = clone(); doc.projects = [];
  doc.sections[0].visible = false;
  doc.fields.find(f => f.type === 'image').value = '';
  doc.sections.push({ id: 'custom-writing', kind: 'cta', label: 'Writing', visible: true, spacing: 'compact', title: 'Writing', body: 'My notes.', linkLabel: 'Read on Medium', linkUrl: 'https://medium.com/@farhansadikgalib' });
  const result = validateDocument(doc);
  assert.equal(result.projects.length, 0);
  assert.equal(result.sections.at(-1).title, 'Writing');
});

test('unknown properties are dropped and markup is retained only as plain content text', () => {
  const doc = clone(); doc.password = 'never persist'; doc.settings.session = 'never persist';
  doc.fields[0].value = '<script>alert(1)</script>';
  const result = validateDocument(doc);
  assert.equal(result.password, undefined);
  assert.equal(result.settings.session, undefined);
  assert.equal(result.fields[0].value, '<script>alert(1)</script>');
});

test('dependent work sections cannot leave the public page empty', () => {
  const introOnly = clone(); introOnly.sections.forEach(section => { section.visible = section.id === 'work-intro'; });
  assert.throws(() => validateDocument(introOnly), { status: 400 });
  const emptyWork = clone(); emptyWork.projects = []; emptyWork.sections.forEach(section => { section.visible = section.id === 'work'; });
  assert.throws(() => validateDocument(emptyWork), { status: 400 });
});
