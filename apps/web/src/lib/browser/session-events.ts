const sessionChangedEvent: string = 'shadowcook:session-changed';

export function notifySessionChanged(): void {
  window.dispatchEvent(new Event(sessionChangedEvent));
}

export function subscribeToSessionChanges(onChange: () => void): () => void {
  window.addEventListener(sessionChangedEvent, onChange);
  return (): void => window.removeEventListener(sessionChangedEvent, onChange);
}
