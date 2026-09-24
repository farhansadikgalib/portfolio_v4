import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { projects } from '../data/projects.js';

// Verify source integrity and local assets, not implementation details.
assert.equal(projects.length, 33, 'The complete portfolio must contain 33 projects.');
assert.equal(new Set(projects.map(project => project.id)).size, projects.length, 'Project IDs must be unique.');
assert.equal(projects.filter(project => project.featured).length, 5, 'Five projects are featured.');
for (const project of projects) {
  assert(project.name && project.id, 'Every project needs a name and stable ID.');
  if (!project.descriptionVerified) assert.equal(project.description, '', `Do not publish inferred features for ${project.name}.`);
  for (const asset of [project.icon, ...project.screenshots].filter(Boolean)) await access(asset);
  for (const [store, url] of Object.entries(project.links).filter(([, url]) => url)) {
    assert.equal(new URL(url).protocol, 'https:');
    assert(project.linkStatuses[store], `Missing availability metadata: ${project.name}/${store}`);
  }
  if (project.featured) assert(project.role && project.screenshots.length >= 3, `Featured project lacks evidence: ${project.name}`);
}
const html = await readFile('index.html', 'utf8');
for (const [, asset] of html.matchAll(/(?:src|href)="((?:assets\/)[^"]+)"/g)) await access(asset);
for (const section of ['home', 'about', 'work', 'craft', 'experience', 'contact']) assert(html.includes(`id="${section}"`));
await access('farhan_resume.pdf');
console.log('Content checks passed: 33 projects, 5 featured stories, verified local assets, store metadata, and required sections.');
