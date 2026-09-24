# Farhan Sadik Galib — portfolio website

A portfolio built with semantic HTML, CSS, and small JavaScript modules, with a Node backend for the private content console. The original README, biography, and résumé are preserved as source material. See [ADMIN.md](ADMIN.md) for account setup, editing, media uploads, publishing, and deployment.

## Preview locally

Requires Node.js 22 or newer. Install dependencies, then start the server.

```sh
npm install
npm run dev
```

Open http://localhost:5173. Use `npm run dev -- --port 3000` to choose another port. Create the owner account with `npm run admin:setup`, then sign in at http://localhost:5173/admin.

## Validate and build

```sh
npm run check
npm test
npm run build
npm run preview
```

The build copies browser assets to `dist/`. Run `npm start` to serve them with the authenticated backend. The CMS requires persistent writable storage and an HTTPS origin in production; it cannot run on static hosting alone. The contact CTA opens the visitor's email client. The only bundled font is a self-hosted Latin subset of Roboto (SIL Open Font License, fonts.google.com/specimen/Roboto) used for the opening name; there are no external font downloads, analytics, or client API keys.

## Where to edit

| File | Contents |
| --- | --- |
| `index.html` | Identity, biography, skills, experience, education, contact, SEO metadata |
| `cms.js` | Applies published content, authenticated previews, editable images, and section ordering |
| `admin/` | Login, page builder, content/project editors, media library, and account controls |
| `server/` | Authentication, protected APIs, validation, storage, and image processing |
| `data/default-content.json` | Seed content used only before CMS storage is initialized and as a static fallback |
| `data/projects.js` | All 33 apps, verified descriptions, store links, availability, icons, screenshots, documented contributions |
| `app.js` | Featured project presentation copy, dialog rendering, filtering, mobile menu, clipboard, one-time reveals |
| `motion.js` | Scroll progress, cinematic stage direction, the opening’s pointer-reactive light rig, project switching, word lighting, accessible static fallbacks |
| `cursor.js` | Travelling pointer: spring follow, direction-aware rotation, speed stretch, accent on hover; off for touch, reduced motion, and browsers without popovers |
| `styles.css` | Design tokens, typography, device frames, glass surfaces, layouts, responsive and reduced-motion rules |
| `assets/projects/` | Optimized local WebP assets from the supplied README |
| `assets/projects/sources.json` | Original image URLs, dimensions, local filenames, and optimization provenance |
| `farhan_resume.pdf` | Downloadable original résumé |
| `CONTENT-NOTES.md` | Content decisions and the information needed to enrich the site |

### Add or update a project

Use the console's Projects editor for managed content. The archive count and featured selector update automatically. `data/projects.js` preserves the original source dataset and provides a fallback; editing it does not overwrite saved CMS content. Each project has a unique `id`, `name`, `category`, `description`, `descriptionVerified`, `featured`, `icon`, `screenshots`, `links`, and per-store `linkStatuses`. Use empty strings for missing links and an empty array for missing screenshots.

Featured projects have a headline, short summary, features, contribution, and preview image positions. The renderer supports new projects without source changes. Add a `.scene-PROJECT_ID` rule with `--project-rgb` in CSS only when you want custom lighting. `projectArtwork()` retains the special MedEx interface composition when its original screenshots are used, and supports replacement images or empty galleries.

Store data is a snapshot from the supplied directory, dated 21 September 2026. `unverified` and `coming-soon` links are visibly distinguished in project details. Recheck listings before changing those statuses.

### Motion and accessibility

- Native modal dialogs provide focus trapping, Escape dismissal, and focus restoration; nested project details return to the project collection.
- Search, category filters, navigation, and project controls work from the keyboard.
- Desktop has three sticky sequences: a gentle opening device composition, a four-project showcase, and the typographic statement. The opening keeps the name and actions readable throughout. Native scrolling drives CSS transforms/opacity through a single requestAnimationFrame coordinator. No wheel or touch events are intercepted. Measurements are cached, inactive scenes are skipped, and the coordinator sleeps between scroll events.
- Project selectors jump directly to the corresponding point in the showcase. The header keeps the full project collection, résumé, and contact within reach.
- Inactive desktop project panels are inert and hidden from accessibility APIs. Their controls cannot receive keyboard focus. The active selector exposes `aria-pressed`.
- At widths of 760px or less, heights of 700px or less, or when reduced motion is preferred, the chapters return to normal document flow. All projects become accessible together; the selector scrolls to each project normally.
- The opening’s lighting (cone spotlight, crossing beams, fills, halo, grain, vignette) reacts to a fine pointer only; it never moves the text or devices out of place, and it stays centred on touch devices.
- `prefers-reduced-motion: reduce` disables entrance animation, parallax, the opening’s pointer light and floating devices, smooth scrolling, and transitions. Changes to the preference are handled without a reload, and hidden project state is removed immediately.
- Ordinary page content remains visible when JavaScript is disabled, including a fallback set of featured store links. The searchable collection and project dialogs require JavaScript.
- All imagery is local; below-the-fold imagery is lazy-loaded. Hero imagery has fixed device dimensions, avoiding layout shifts.

The opening is a centred title card (headline, summary, actions) above the centred device stage, with a caption line above the phones and one aligned bar along the bottom holding the proof stats, the scroll cue, and the current role; the name is a small signature line in the topline. The stage holds three CSS device frames showing ACI ECOLINK (catalogue, dashboard, service request), each containing clean, unoverlaid interface regions from the store artwork. On desktop the frames bleed past the bottom of the sticky stage and rise as the visitor scrolls; on phones and with reduced motion they sit fully in view. MedEx also uses genuine interface crops. Full original store artwork remains available in each project gallery. No app UI, client logo, headshot, or product metrics were generated.

## Verification performed

The cinematic redesign passed 73 browser checks. See `QUALITY-REVIEW.md` for the design assessment, scroll-navigation checks, short-screen fallback, and measured performance sample.

Validated in Chrome 153 at widths 320, 360, 390, 540, 541, 768, 800, 801, 1024, 1100, and 1440 px. No horizontal page overflow or overflowing text remained. Desktop and phone interaction checks covered project details, all 33 collection entries, search/no-result states, category filters, nested dialogs, Escape dismissal, focus restoration, background scroll locking, and the mobile menu. Reduced-motion mode showed no active animations or hidden content. No broken images, console errors, or failed local requests were observed. The résumé returned successfully, and a JavaScript-disabled check confirmed the basic content and four fallback store links remain available. `npm run check` and `npm run build` passed.

These checks cover the local static site. External store availability retains the supplied directory's verification date; this work does not claim a new live availability audit or a measured device frame-rate benchmark.
