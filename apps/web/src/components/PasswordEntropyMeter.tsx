import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { Translation } from '../i18n';
import { estimatePasswordEntropy, passwordAnalysisMaximumLength } from '../lib/password-entropy';

interface PasswordEntropyMeterProperties {
  text: Translation;
  password: string;
  minimumEntropy?: number;
}

const calculationDelayMilliseconds: number = 200;

export default function PasswordEntropyMeter({
  text,
  password,
  minimumEntropy,
}: PasswordEntropyMeterProperties): JSX.Element {
  const [configuredMinimumEntropy, setConfiguredMinimumEntropy] = useState<number>(60);
  const [entropy, setEntropy] = useState<number>(0);
  useEffect((): void => {
    if (minimumEntropy !== undefined) return;
    void fetch('/api/auth/password-requirements', { credentials: 'same-origin' })
      .then(async (response: Response): Promise<void> => {
        if (!response.ok) return;
        const data = (await response.json()) as { minimumPasswordEntropy: number };
        setConfiguredMinimumEntropy(data.minimumPasswordEntropy);
      })
      .catch((): void => undefined);
  }, [minimumEntropy]);
  useEffect((): (() => void) | void => {
    if (password.length === 0) {
      setEntropy(0);
      return;
    }
    const timerId: number = window.setTimeout((): void => {
      setEntropy(estimatePasswordEntropy(password));
    }, calculationDelayMilliseconds);
    return (): void => window.clearTimeout(timerId);
  }, [password]);
  const threshold: number = minimumEntropy ?? configuredMinimumEntropy;
  const progressWidth: number = Math.min(100, (entropy / threshold) * 50);
  return (
    <div className="password-entropy-meter-container">
      <div
        className="password-entropy-meter"
        role="progressbar"
        aria-label={text.passwordEntropy.progressLabel}
        aria-valuemin={0}
        aria-valuemax={threshold * 2}
        aria-valuenow={Math.round(Math.min(entropy, threshold * 2))}
      >
        <span className="password-entropy-meter__fill" style={{ width: `${progressWidth}%` }} />
        <span className="password-entropy-meter__threshold" aria-hidden="true" />
      </div>
      <p className="hint">
        {text.passwordEntropy.value
          .replace('{entropy}', String(Math.round(entropy)))
          .replace('{threshold}', String(threshold))}
      </p>
      {password.length > passwordAnalysisMaximumLength ? (
        <p className="hint">
          {text.passwordEntropy.analysisLimit.replace(
            '{maximum}',
            String(passwordAnalysisMaximumLength),
          )}
        </p>
      ) : null}
    </div>
  );
}
