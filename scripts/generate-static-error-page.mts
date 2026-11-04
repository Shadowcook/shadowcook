import { writeFileSync } from 'node:fs';
import { errorEnglish } from '../apps/web/src/i18n/errors.ts';

// Apache cannot load the application locale. Generate its default English copy from the UI dictionary.
const text: typeof errorEnglish = errorEnglish;
const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character: string): string =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );
const html: string = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(text.service.title)} · ${escapeHtml(text.brand)}</title>
  <style>
    :root { color-scheme: light; font: 1.15rem/1.6 Georgia, 'Times New Roman', serif; color: #28211d; background: #f6f1e7; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    header { padding: 1.5rem max(1.5rem, calc((100vw - 65rem) / 2)); border-bottom: 1px solid #dfd3c2; font-size: 1.7rem; }
    main { max-width: 45rem; margin: 10vh auto; padding: 2rem; }
    section { padding: clamp(1.5rem, 5vw, 3rem); border: 1px solid #dfd3c2; border-radius: .7rem; background: #fffdf8; }
    h1 { line-height: 1.2; font-size: clamp(1.8rem, 5vw, 2.6rem); }
    a { display: inline-block; margin-top: 1rem; padding: .7rem 1.1rem; background: #745742; color: #fff; border-radius: .35rem; text-decoration: none; }
    a:focus-visible { outline: 3px solid #28211d; outline-offset: 4px; }
  </style>
</head>
<body>
  <header>${escapeHtml(text.brand)}</header>
  <main><section aria-labelledby="error-title">
    <h1 id="error-title">${escapeHtml(text.service.title)}</h1>
    <p>${escapeHtml(text.service.description)}</p>
    <a href="/">${escapeHtml(text.home)}</a>
  </section></main>
</body>
</html>
`;
writeFileSync(new URL('../deployments/package/errors/50x.html', import.meta.url), html);
