import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../../../i18n';
import type { Locale, Translation } from '../../../i18n';
import { localizedUnitName, localizedUnitSymbol } from '../../../i18n/unit-localization';
import AdminIcon from '../../../components/AdminIcon';

interface Unit {
  publicId: string;
  name: string;
  symbol: string;
  localizationKey: string | null;
  convertible: boolean;
  baseFactor: string | null;
  usageCount: number;
}
interface UnitForm {
  name: string;
  symbol: string;
  equivalenceAmount: string;
  referenceUnitPublicId: string;
}
type ConversionMode = 'NONE' | 'EQUIVALENT';
const emptyForm: UnitForm = {
  name: '',
  symbol: '',
  equivalenceAmount: '',
  referenceUnitPublicId: '',
};
export default function TenantUnitManagement({
  locale,
  tenantSlug,
}: {
  locale: Locale;
  tenantSlug: string;
}): JSX.Element {
  const text: Translation = translations[locale];
  const [units, setUnits] = useState<Unit[]>([]);
  const [references, setReferences] = useState<Unit[]>([]);
  const [form, setForm] = useState<UnitForm>(emptyForm);
  const [conversionMode, setConversionMode] = useState<ConversionMode>('NONE');
  const [editing, setEditing] = useState<Unit | null>(null);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  const endpoint = (suffix: string = ''): string =>
    `/api/cookbook/tenants/${encodeURIComponent(tenantSlug)}/units${suffix}`;
  const refresh = (): void => {
    void loadUnits(endpoint(), setUnits, setReferences);
  };
  useEffect(refresh, [tenantSlug]);
  const update = (field: keyof UnitForm, value: string): void =>
    setForm((current: UnitForm): UnitForm => ({ ...current, [field]: value }));
  const close = (): void => {
    setEditing(null);
    setForm(emptyForm);
    setConversionMode('NONE');
    setShowForm(false);
  };
  const edit = (unit: Unit): void => {
    setEditing(unit);
    setForm({
      name: unit.name,
      symbol: unit.symbol,
      equivalenceAmount: '',
      referenceUnitPublicId: '',
    });
    setConversionMode('NONE');
    setShowForm(true);
  };
  async function save(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const hasConversion: boolean = conversionMode === 'EQUIVALENT';
    const body =
      editing === null
        ? {
            name: form.name,
            symbol: form.symbol,
            equivalenceAmount: hasConversion ? form.equivalenceAmount : null,
            referenceUnitPublicId: hasConversion ? form.referenceUnitPublicId : null,
          }
        : { name: form.name, symbol: form.symbol };
    const response: Response = await fetch(
      editing === null ? endpoint() : endpoint(`/${editing.publicId}`),
      {
        method: editing === null ? 'POST' : 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      const error = (await response.json().catch((): object => ({}))) as { code?: string };
      setMessage(
        error.code === 'UNIT_IN_USE'
          ? text.tenantUnits.cannotChangeUsed
          : text.errors.requestFailed,
      );
      return;
    }
    setMessage(editing === null ? text.tenantUnits.created : text.tenantUnits.updated);
    close();
    refresh();
  }
  async function remove(unit: Unit): Promise<void> {
    const response: Response = await fetch(endpoint(`/${unit.publicId}`), {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    setMessage(response.ok ? text.tenantUnits.deleted : text.tenantUnits.cannotDelete);
    if (response.ok) refresh();
  }
  return (
    <section className="admin-page admin-page--wide">
      <div className="dashboard__header">
        <div>
          <p className="eyebrow">{text.tenantNavigation.units}</p>
          <h1>{text.tenantUnits.title}</h1>
        </div>
        <button
          type="button"
          onClick={(): void => {
            setEditing(null);
            setForm(emptyForm);
            setConversionMode('NONE');
            setShowForm(true);
          }}
        >
          {text.tenantUnits.create}
        </button>
      </div>
      <p className="lede">{text.tenantUnits.description}</p>
      {message.length > 0 ? (
        <p className="message" role="status">
          {message}
        </p>
      ) : null}
      <div className="unit-table-container">
        <table className="tenant-table unit-table">
          <thead>
            <tr>
              <th>{text.tenantUnits.name}</th>
              <th>{text.tenantUnits.symbol}</th>
              <th>{text.tenantUnits.conversion}</th>
              <th>{text.tenantUnits.usage}</th>
              <th>{text.dashboard.actions}</th>
            </tr>
          </thead>
          <tbody>
            {units.map((unit: Unit): JSX.Element => (
              <tr key={unit.publicId}>
                <td>{unit.name}</td>
                <td>{unit.symbol}</td>
                <td>{unit.convertible ? text.tenantUnits.equivalent : '—'}</td>
                <td>{unit.usageCount}</td>
                <td>
                  <div className="tenant-actions">
                    <button
                      type="button"
                      aria-label={text.dashboard.rename}
                      title={text.dashboard.rename}
                      onClick={(): void => edit(unit)}
                    >
                      <AdminIcon name="edit" />
                    </button>
                    <button
                      type="button"
                      aria-label={text.dashboard.delete}
                      title={
                        unit.usageCount > 0 ? text.tenantUnits.cannotDelete : text.dashboard.delete
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
      {!showForm ? null : (
        <div className="modal-backdrop">
          <section className="modal" aria-labelledby="tenant-unit-title">
            <h2 id="tenant-unit-title">
              {editing === null ? text.tenantUnits.create : text.tenantUnits.edit}
            </h2>
            <form onSubmit={(event: SubmitEvent<HTMLFormElement>): void => void save(event)}>
              <label>
                {text.tenantUnits.name}
                <input
                  required
                  value={form.name}
                  onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                    update('name', event.currentTarget.value)
                  }
                />
              </label>
              <label>
                {text.tenantUnits.symbol}
                <input
                  required
                  value={form.symbol}
                  onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                    update('symbol', event.currentTarget.value)
                  }
                />
              </label>
              {editing === null ? (
                <fieldset>
                  <legend>{text.tenantUnits.conversion}</legend>
                  <label className="tenant-unit-conversion__option">
                    <input
                      type="radio"
                      name="unit-conversion"
                      checked={conversionMode === 'NONE'}
                      onChange={(): void => setConversionMode('NONE')}
                    />
                    {text.tenantUnits.notConvertible}
                  </label>
                  <label className="tenant-unit-conversion__option">
                    <input
                      type="radio"
                      name="unit-conversion"
                      checked={conversionMode === 'EQUIVALENT'}
                      onChange={(): void => setConversionMode('EQUIVALENT')}
                    />
                    {text.tenantUnits.equivalentOption}
                  </label>
                  {conversionMode === 'EQUIVALENT' ? (
                    <label className="tenant-unit-conversion__details">
                      {text.tenantUnits.equivalent}
                      <input
                        required
                        inputMode="decimal"
                        value={form.equivalenceAmount}
                        onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                          update('equivalenceAmount', event.currentTarget.value)
                        }
                        placeholder="15"
                      />
                      <select
                        required
                        value={form.referenceUnitPublicId}
                        onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
                          update('referenceUnitPublicId', event.currentTarget.value)
                        }
                      >
                        <option value="">{text.admin.selectUnit}</option>
                        {references.map((unit: Unit): JSX.Element => (
                          <option key={unit.publicId} value={unit.publicId}>
                            {localizedUnitName(text, unit.localizationKey, unit.name)} (
                            {localizedUnitSymbol(text, unit.localizationKey, unit.symbol)})
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </fieldset>
              ) : null}
              <button type="submit">{text.admin.save}</button>
              <button type="button" className="button--secondary" onClick={close}>
                {text.admin.cancel}
              </button>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
async function loadUnits(
  path: string,
  setUnits: (units: Unit[]) => void,
  setReferences: (units: Unit[]) => void,
): Promise<void> {
  const response: Response = await fetch(path, { credentials: 'same-origin' });
  if (response.ok) {
    const payload = (await response.json()) as { units: Unit[]; referenceUnits: Unit[] };
    setUnits(payload.units);
    setReferences(payload.referenceUnits);
  }
}
