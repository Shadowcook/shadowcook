import type { JSX } from 'react';

interface StatusMessageProperties {
  message: string;
}

export default function StatusMessage({ message }: StatusMessageProperties): JSX.Element | null {
  return message.length === 0 ? null : (
    <p className="message" role="alert">
      {message}
    </p>
  );
}
