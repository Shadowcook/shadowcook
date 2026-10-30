export async function loadRecipePdfLogo(): Promise<string> {
  const response: Response = await fetch('/shadowcook-logo.png', { credentials: 'same-origin' });
  if (!response.ok || response.headers.get('content-type')?.split(';')[0]?.trim() !== 'image/png') {
    throw new Error('PDF_LOGO_LOAD_FAILED');
  }
  const bytes: Uint8Array = new Uint8Array(await response.arrayBuffer());
  let binary: string = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}
