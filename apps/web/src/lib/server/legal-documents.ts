const defaultApiOrigin: string = 'http://localhost:3000';

export interface LegalDocuments {
  privacyStatementMarkdown: string;
  imprintMarkdown: string;
}

export async function loadLegalDocuments(): Promise<LegalDocuments> {
  const apiOrigin: string = process.env.SHADOWCOOK_API_ORIGIN ?? defaultApiOrigin;
  try {
    const response: Response = await fetch(new URL('/legal-documents', apiOrigin));
    if (!response.ok) return emptyLegalDocuments();
    return (await response.json()) as LegalDocuments;
  } catch (_error: unknown) {
    return emptyLegalDocuments();
  }
}

function emptyLegalDocuments(): LegalDocuments {
  return { privacyStatementMarkdown: '', imprintMarkdown: '' };
}
