import type { JSX } from 'react';

export default function RequestErrorModal(properties: {
  title: string;
  message: string;
  dismiss: string;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="modal-backdrop modal-backdrop--error">
      <section className="modal" role="alertdialog" aria-labelledby="request-error-title">
        <h2 id="request-error-title">{properties.title}</h2>
        <p>{properties.message}</p>
        <button type="button" onClick={properties.onClose} autoFocus>
          {properties.dismiss}
        </button>
      </section>
    </div>
  );
}
