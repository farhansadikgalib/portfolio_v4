import { mkdir, copyFile, cp } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js', 'cms.js', 'motion.js', 'farhan_resume.pdf']) await copyFile(file, `dist/${file}`);
for (const directory of ['data', 'assets', 'admin']) await cp(directory, `dist/${directory}`, { recursive: true });
console.log('Built public site and console assets in dist/. Run npm start to serve them with the authenticated CMS backend.');
