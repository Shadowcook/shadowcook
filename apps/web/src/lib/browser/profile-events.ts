const profileUpdatedEvent: string = 'shadowcook:profile-updated';

export function notifyProfileUpdated(displayName: string): void {
  window.dispatchEvent(new CustomEvent<string>(profileUpdatedEvent, { detail: displayName }));
}

export function subscribeToProfileUpdates(onUpdate: (displayName: string) => void): () => void {
  const listener: EventListener = (event: Event): void => {
    if (event instanceof CustomEvent && typeof event.detail === 'string') onUpdate(event.detail);
  };
  window.addEventListener(profileUpdatedEvent, listener);
  return (): void => window.removeEventListener(profileUpdatedEvent, listener);
}
