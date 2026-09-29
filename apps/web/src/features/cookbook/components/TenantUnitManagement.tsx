import { useEffect, useState } from 'react';
import type { ChangeEvent, JSX, SubmitEvent } from 'react';
import { translations } from '../../../i18n';
import type { Locale, Translation } from '../../../i18n';
import AdminIcon from '../../../components/AdminIcon';

type UnitDimension = 'MASS' | 'VOLUME' | 'COUNT' | 'TEMPERATURE';
interface Unit {
  publicId: string;
  name: string;
  symbol: string;
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
const dimensions: readonly UnitDimension[] = ['MASS', 'VOLUME', 'COUNT', 'TEMPERATURE'];
const emptyForm: UnitForm = {
  name: '',
  symbol: '',
  dimension: 'MASS',
  baseFactor: '1',
  baseOffset: '0',
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
  const [form, setForm] = useState<UnitForm>(emptyForm);
  const [editing, setEditing] = useState<Unit | null>(null);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  function endpoint(suffix: string = ''): string {
    return `/api/cookbook/tenants/${encodeURIComponent(tenantSlug)}/units${suffix}`;
  }
  function refresh(): void {
    void loadUnits(endpoint(), setUnits);
  }
  useEffect(refresh, [tenantSlug]);
  function update(field: keyof UnitForm, value: string): void {
    setForm((current: UnitForm): UnitForm => ({ ...current, [field]: value }));
  }
  function closeForm(): void {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(false);
  }
  function openCreate(): void {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
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
    setShowForm(true);
  }
  async function save(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const response: Response = await fetch(
      editing === null ? endpoint() : endpoint(`/${editing.publicId}`),
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
    setMessage(editing === null ? text.tenantUnits.created : text.tenantUnits.updated);
    closeForm();
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
        <button type="button" onClick={openCreate}>
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
              <th>{text.tenantUnits.dimension}</th>
              <th>{text.tenantUnits.baseFactor}</th>
              <th>{text.tenantUnits.baseOffset}</th>
              <th>{text.tenantUnits.usage}</th>
              <th>{text.dashboard.actions}</th>
            </tr>
          </thead>
          <tbody>
            {units.map((unit: Unit): JSX.Element => (
              <tr key={unit.publicId}>
                <td>{unit.name}</td>
                <td>{unit.symbol}</td>
                <td>{text.tenantUnits.dimensions[unit.dimension]}</td>
                <td>{unit.baseFactor}</td>
                <td>{unit.baseOffset}</td>
                <td>{unit.usageCount}</td>
                <td>
                  <div className="tenant-actions">
                    <button
                      type="button"
                      aria-label={text.dashboard.rename}
                      title={text.dashboard.rename}
                      onClick={(): void => openEdit(unit)}
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
              <label>
                {text.tenantUnits.dimension}
                <select
                  value={form.dimension}
                  onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
                    update('dimension', event.currentTarget.value)
                  }
                >
                  {dimensions.map((dimension: UnitDimension): JSX.Element => (
                    <option key={dimension} value={dimension}>
                      {text.tenantUnits.dimensions[dimension]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {text.tenantUnits.baseFactor}
                <input
                  required
                  inputMode="decimal"
                  pattern="(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,12})?"
                  value={form.baseFactor}
                  onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                    update('baseFactor', event.currentTarget.value)
                  }
                />
              </label>
              <label>
                {text.tenantUnits.baseOffset}
                <input
                  required
                  disabled={form.dimension !== 'TEMPERATURE'}
                  inputMode="decimal"
                  pattern="-?(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,12})?"
                  value={form.baseOffset}
                  onChange={(event: ChangeEvent<HTMLInputElement>): void =>
                    update('baseOffset', event.currentTarget.value)
                  }
                />
              </label>
              <button type="submit">{text.admin.save}</button>
              <button type="button" className="button--secondary" onClick={closeForm}>
                {text.admin.cancel}
              </button>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
async function loadUnits(path: string, setUnits: (units: Unit[]) => void): Promise<void> {
  const response: Response = await fetch(path, { credentials: 'same-origin' });
  if (response.ok) setUnits(((await response.json()) as { units: Unit[] }).units);
}
