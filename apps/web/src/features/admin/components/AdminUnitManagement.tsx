import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../../../i18n';
import type { Locale, Translation } from '../../../i18n';
import { localizedUnitName, localizedUnitSymbol } from '../../../i18n/unit-localization';
import AdminIcon from '../../../components/AdminIcon';

type UnitDimension = 'MASS' | 'VOLUME' | 'COUNT' | 'TEMPERATURE';

interface Unit {
  publicId: string;
  name: string;
  symbol: string;
  localizationKey: string | null;
  dimension: UnitDimension;
  baseFactor: string;
  baseOffset: string;
  usageCount: number;
}

interface UnitForm {
  name: string;
  symbol: string;
  dimension: UnitDimension;
  baseFactor: string;
  baseOffset: string;
}

const emptyUnit: UnitForm = {
  name: '',
  symbol: '',
  dimension: 'MASS',
  baseFactor: '1',
  baseOffset: '0',
};

const dimensions: readonly UnitDimension[] = ['MASS', 'VOLUME', 'COUNT', 'TEMPERATURE'];

export default function AdminUnitManagement({ locale }: { locale: Locale }): JSX.Element {
  const text: Translation = translations[locale];
  const [units, setUnits] = useState<Unit[]>([]);
  const [form, setForm] = useState<UnitForm>(emptyUnit);
  const [editing, setEditing] = useState<Unit | null>(null);
  const [message, setMessage] = useState<string>('');
  const [sourceId, setSourceId] = useState<string>('');
  const [targetId, setTargetId] = useState<string>('');
  const [amount, setAmount] = useState<string>('1');
  const [conversion, setConversion] = useState<string>('');

  function refresh(): void {
    void loadUnits(setUnits);
  }
  function update(field: keyof UnitForm, value: string): void {
    setForm((current: UnitForm): UnitForm => ({ ...current, [field]: value }));
  }
  function closeForm(): void {
    setEditing(null);
    setForm(emptyUnit);
  }
  function openEdit(unit: Unit): void {
    setEditing(unit);
    setForm({
      name: unit.name,
      symbol: unit.symbol,
      dimension: unit.dimension,
      baseFactor: unit.baseFactor,
      baseOffset: unit.baseOffset,
    });
    setMessage('');
  }
  async function save(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const response: Response = await fetch(
      editing === null ? '/api/admin/units' : `/api/admin/units/${editing.publicId}`,
      {
        method: editing === null ? 'POST' : 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      },
    );
    if (!response.ok) {
      setMessage(text.errors.requestFailed);
      return;
    }
    setMessage(editing === null ? text.admin.unitCreated : text.admin.unitUpdated);
    closeForm();
    refresh();
  }
  async function remove(unit: Unit): Promise<void> {
    const response: Response = await fetch(`/api/admin/units/${unit.publicId}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    setMessage(response.ok ? text.admin.unitDeleted : text.admin.unitCannotDelete);
    if (response.ok) refresh();
  }
  async function convert(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const response: Response = await fetch('/api/admin/units/convert', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, sourceUnitPublicId: sourceId, targetUnitPublicId: targetId }),
    });
    if (!response.ok) {
      setConversion(text.admin.conversionUnavailable);
      return;
    }
    const result = (await response.json()) as { amount: string };
    const target = units.find((unit: Unit): boolean => unit.publicId === targetId);
    setConversion(
      `${result.amount} ${
        target === undefined ? '' : localizedUnitSymbol(text, target.localizationKey, target.symbol)
      }`.trim(),
    );
  }

  useEffect(refresh, []);
  const source: Unit | undefined = units.find((unit: Unit): boolean => unit.publicId === sourceId);
  const conversionTargets: Unit[] = units.filter(
    (unit: Unit): boolean => source !== undefined && unit.dimension === source.dimension,
  );
  return (
    <section className="admin-page admin-page--wide">
      <div className="dashboard__header">
        <div>
          <p className="eyebrow">{text.admin.units}</p>
          <h1>{text.admin.unitsTitle}</h1>
        </div>
        <button onClick={closeForm}>{text.admin.createUnit}</button>
      </div>
      <p className="lede">{text.admin.unitsDescription}</p>
      {message.length > 0 ? (
        <p className="message" role="status">
          {message}
        </p>
      ) : null}
      <form
        className="unit-form"
        onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void save(event)}
      >
        <h2>{editing === null ? text.admin.createUnit : text.admin.editUnit}</h2>
        <label>
          {text.admin.unitName}
          <input
            value={form.name}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              update('name', event.currentTarget.value)
            }
            required
          />
        </label>
        <label>
          {text.admin.unitSymbol}
          <input
            value={form.symbol}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              update('symbol', event.currentTarget.value)
            }
            required
          />
        </label>
        <label>
          {text.admin.unitDimension}
          <select
            value={form.dimension}
            onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
              update('dimension', event.currentTarget.value)
            }
          >
            {dimensions.map((dimension: UnitDimension): JSX.Element => (
              <option key={dimension} value={dimension}>
                {text.admin.unitDimensions[dimension]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {text.admin.unitBaseFactor}
          <input
            value={form.baseFactor}
            inputMode="decimal"
            pattern="(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,12})?"
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              update('baseFactor', event.currentTarget.value)
            }
            required
          />
        </label>
        <label>
          {text.admin.unitBaseOffset}
          <input
            value={form.baseOffset}
            inputMode="decimal"
            pattern="-?(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,12})?"
            disabled={form.dimension !== 'TEMPERATURE'}
            onChange={(event: ChangeEvent<HTMLInputElement>): void =>
              update('baseOffset', event.currentTarget.value)
            }
            required
          />
        </label>
        <div>
          <button type="submit">{text.admin.save}</button>
          {editing === null ? null : (
            <button type="button" className="button--secondary" onClick={closeForm}>
              {text.admin.cancel}
            </button>
          )}
        </div>
      </form>
      <div className="unit-table-container">
        <table className="tenant-table unit-table">
          <thead>
            <tr>
              <th>{text.admin.unitName}</th>
              <th>{text.admin.unitSymbol}</th>
              <th>{text.admin.unitDimension}</th>
              <th>{text.admin.unitBaseFactor}</th>
              <th>{text.admin.unitBaseOffset}</th>
              <th>{text.admin.unitUsage}</th>
              <th>{text.dashboard.actions}</th>
            </tr>
          </thead>
          <tbody>
            {units.map((unit: Unit): JSX.Element => (
              <tr key={unit.publicId}>
                <td>{localizedUnitName(text, unit.localizationKey, unit.name)}</td>
                <td>{localizedUnitSymbol(text, unit.localizationKey, unit.symbol)}</td>
                <td>{text.admin.unitDimensions[unit.dimension]}</td>
                <td>{unit.baseFactor}</td>
                <td>{unit.baseOffset}</td>
                <td>{unit.usageCount}</td>
                <td>
                  <div className="tenant-actions">
                    <button
                      aria-label={text.dashboard.rename}
                      title={text.dashboard.rename}
                      onClick={(): void => openEdit(unit)}
                    >
                      <AdminIcon name="edit" />
                    </button>
                    <button
                      aria-label={text.dashboard.delete}
                      title={
                        unit.usageCount > 0 ? text.admin.unitCannotDelete : text.dashboard.delete
                      }
                      disabled={unit.usageCount > 0}
                      onClick={(): void => void remove(unit)}
                    >
                      <AdminIcon name="delete" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="unit-converter" aria-labelledby="unit-converter-title">
        <h2 id="unit-converter-title">{text.admin.conversionTitle}</h2>
        <form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void convert(event)}>
          <label>
            {text.admin.conversionAmount}
            <input
              value={amount}
              inputMode="decimal"
              onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                setAmount(event.currentTarget.value)
              }
              required
            />
          </label>
          <label>
            {text.admin.conversionFrom}
            <select
              value={sourceId}
              onChange={(event: ChangeEvent<HTMLSelectElement>): void => {
                setSourceId(event.currentTarget.value);
                setTargetId('');
                setConversion('');
              }}
              required
            >
              <option value="">{text.admin.selectUnit}</option>
              {units.map((unit: Unit): JSX.Element => (
                <option key={unit.publicId} value={unit.publicId}>
                  {localizedUnitName(text, unit.localizationKey, unit.name)} (
                  {localizedUnitSymbol(text, unit.localizationKey, unit.symbol)})
                </option>
              ))}
            </select>
          </label>
          <label>
            {text.admin.conversionTo}
            <select
              value={targetId}
              onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
                setTargetId(event.currentTarget.value)
              }
              required
              disabled={source === undefined}
            >
              <option value="">{text.admin.selectUnit}</option>
              {conversionTargets.map((unit: Unit): JSX.Element => (
                <option key={unit.publicId} value={unit.publicId}>
                  {localizedUnitName(text, unit.localizationKey, unit.name)} (
                  {localizedUnitSymbol(text, unit.localizationKey, unit.symbol)})
                </option>
              ))}
            </select>
          </label>
          <button type="submit">{text.admin.convert}</button>
        </form>
        {conversion.length > 0 ? <output>{conversion}</output> : null}
      </section>
    </section>
  );
}

async function loadUnits(setUnits: (units: Unit[]) => void): Promise<void> {
  const response: Response = await fetch('/api/admin/units', { credentials: 'same-origin' });
  if (response.ok) setUnits(((await response.json()) as { units: Unit[] }).units);
}
