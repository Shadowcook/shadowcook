import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX } from 'react';
import type { Translation } from '../../../i18n';

interface Properties {
  label: string;
  value: number | null;
  text: Translation;
  onChange: (minutes: number | null) => void;
}

export default function RecipeDurationInput({
  label,
  value,
  text,
  onChange,
}: Properties): JSX.Element {
  const [hours, setHours] = useState<string>(value === null ? '' : String(Math.floor(value / 60)));
  const [minutes, setMinutes] = useState<string>(value === null ? '' : String(value % 60));
  useEffect((): void => {
    const current: number | null =
      hours === '' && minutes === '' ? null : Number(hours) * 60 + Number(minutes);
    if (current === value) return;
    setHours(value === null ? '' : String(Math.floor(value / 60)));
    setMinutes(value === null ? '' : String(value % 60));
  }, [value]);

  function change(nextHours: string, nextMinutes: string): void {
    setHours(nextHours);
    setMinutes(nextMinutes);
    onChange(
      nextHours === '' && nextMinutes === '' ? null : Number(nextHours) * 60 + Number(nextMinutes),
    );
  }

  return (
    <fieldset className="recipe-duration">
      <legend>{label}</legend>
      <div className="recipe-duration__inputs">
        <label>
          {text.recipeMetadata.hours}
          <input
            type="number"
            min={0}
            max={87600}
            step={1}
            value={hours}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              change(event.currentTarget.value, minutes)
            }
          />
        </label>
        <label>
          {text.recipeMetadata.minutes}
          <input
            type="number"
            min={0}
            max={59}
            step={1}
            value={minutes}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              change(hours, event.currentTarget.value)
            }
          />
        </label>
      </div>
    </fieldset>
  );
}
