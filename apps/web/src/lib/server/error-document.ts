import { errorEnglish, errorGerman, type ErrorTranslation } from '../../i18n/errors.ts';

export function errorDocument(locale: 'en' | 'de', status: number): Response {
  const text: ErrorTranslation = locale === 'de' ? errorGerman : errorEnglish;
  const copy: { title: string; description: string } =
    status === 403
      ? text.denied
      : status === 404
        ? text.notFound
        : status === 429
          ? text.limited
          : text.service;
  return new Response(
    `<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>${copy.title}</title><style>body{margin:0;background:#f6f1e7;color:#28211d;font:1.2rem Georgia,serif}main{max-width:40rem;margin:10vh auto;padding:2rem}a{color:#745742}</style><main><p>${text.brand} · ${status}</p><h1>${copy.title}</h1><p>${copy.description}</p><a href="/">${text.home}</a></main></html>`,
    {
      status,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    },
  );
}
