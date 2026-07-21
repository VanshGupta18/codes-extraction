import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageStrip } from '@ui5/webcomponents-react';
import { addLegacyMaterial, isPendingLegacyMaterial } from '../services/odataClient';

const MATERIAL_TYPES = ['ZICM', 'ZOES', 'ZICN', 'ZDCL'];
const BASE_UNITS = ['', 'NO', 'EA', 'ST', 'KG', 'MM', 'LT'];

const ADVANCED_GROUPS = [
  [['Numerator_1', 'Numerator 1'], ['Denominator_1', 'Denominator 1'], ['Display_Unit_Measure_1', 'Display unit 1'], ['Base_Unit_of_Measure_1', 'Base unit 1']],
  [['Numerator_2', 'Numerator 2'], ['Denominator_2', 'Denominator 2'], ['Display_Unit_Measure_2', 'Display unit 2'], ['Base_Unit_of_Measure_2', 'Base unit 2']],
  [['Numerator_3', 'Numerator 3'], ['Denominator_3', 'Denominator 3'], ['Display_Unit_Measure_3', 'Display unit 3']],
  [['Numerator_4', 'Numerator 4'], ['Denominator_4', 'Denominator 4'], ['Display_Unit_Measure_4', 'Display unit 4']],
  [['Numerator_5', 'Numerator 5'], ['Denominator_5', 'Denominator 5']],
];

const ALL_KEYS = [
  'Material', 'Material_Description', 'Material_Type', 'Material_Group',
  'Legacy_Company_Code', 'ZZ1_MM_RP_PLT', 'Manufacturer_Part_No_', 'Old_material_number',
  'Legacy_Field_Value', 'Base_Unit_of_Measure', 'Unit_of_Weight', 'Volume_Unit', 'Display_Unit_Measure',
  'Material_Group_3', 'Material_Group_4', 'Loading_Group',
  'Material_Description_1', 'Process_Flag', 'Valuation_Class', 'POTXT', 'Item_Plan_Type',
  'Storage_Location_Extend', 'Plant_type_Legacy', 'Valid_From', 'DOMESTIC_FLAG', 'NO_STOCK_CHECK_IND',
  ...ADVANCED_GROUPS.flat().map(([k]) => k),
];

const INITIAL_STATE = Object.fromEntries(
  ALL_KEYS.map((key) => [key, key === 'Material_Type' ? 'ZICM' : '']),
);

function SapSection({ title, subtitle, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`hsn-mm__section${open ? '' : ' hsn-mm__section--collapsed'}`}>
      <button
        type="button"
        className="hsn-mm__section-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="hsn-mm__section-chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="hsn-mm__section-title">{title}</span>
        {subtitle && <span className="hsn-mm__section-sub">{subtitle}</span>}
      </button>
      {open && <div className="hsn-mm__section-body">{children}</div>}
    </section>
  );
}

function SapField({
  label,
  fieldKey,
  value,
  onChange,
  required = false,
  size = 'sm',
  error,
  options,
  hint,
}) {
  const inputClass = `hsn-mm__input hsn-mm__input--${size}${error ? ' hsn-mm__input--error' : ''}`;

  return (
    <div className={`hsn-mm__row${error ? ' hsn-mm__row--error' : ''}`}>
      <label className="hsn-mm__label" htmlFor={fieldKey}>
        {label}
        {required && <span className="hsn-mm__req" aria-hidden="true">*</span>}
      </label>
      <div className="hsn-mm__field">
        {options ? (
          <select
            id={fieldKey}
            className={inputClass}
            value={value}
            onChange={(e) => onChange(fieldKey, e.target.value)}
          >
            {options.map((opt) => (
              <option key={opt || 'empty'} value={opt}>{opt || '—'}</option>
            ))}
          </select>
        ) : (
          <input
            id={fieldKey}
            type="text"
            className={inputClass}
            value={value}
            onChange={(e) => onChange(fieldKey, e.target.value)}
            aria-invalid={Boolean(error)}
          />
        )}
        {hint && <span className="hsn-mm__hint">{hint}</span>}
        {error && <span className="hsn-mm__error">{error}</span>}
      </div>
    </div>
  );
}

export default function IngestionPage() {
  const [formData, setFormData] = useState(INITIAL_STATE);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const validate = async () => {
    const next = {};
    for (const key of ['Material', 'Material_Description', 'Material_Type', 'Material_Group']) {
      if (!(formData[key] || '').trim()) next[key] = 'Required';
    }
    const material = formData.Material.trim();
    if (material && !next.Material) {
      const pending = await isPendingLegacyMaterial(material);
      if (pending) next.Material = 'Already pending (HSN 9999)';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);
    if (!(await validate())) return;

    setLoading(true);
    try {
      await addLegacyMaterial(formData);
      setMessage({
        type: 'success',
        text: `Material ${formData.Material.trim()} added to the classification queue.`,
      });
      setFormData(INITIAL_STATE);
      setErrors({});
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const field = (label, key, opts = {}) => (
    <SapField
      label={label}
      fieldKey={key}
      value={formData[key]}
      onChange={handleChange}
      error={errors[key]}
      {...opts}
    />
  );

  return (
    <div className="hsn-mm">
      <header className="hsn-mm__page-header">
        <div>
          <h1 className="hsn-mm__page-title">Create Material</h1>
          <p className="hsn-mm__page-desc">
            Add to the legacy classification queue. Matches SAP MM field layout — saved with dummy HSN until approved.
          </p>
        </div>
        <div className="hsn-mm__badges" aria-label="System defaults">
          <span className="hsn-mm__badge">HSN 9999</span>
          <span className="hsn-mm__badge">Effective till open</span>
          <span className="hsn-mm__badge">Serial on save</span>
        </div>
      </header>

      {message && (
        <MessageStrip
          design={message.type === 'error' ? 'Negative' : 'Positive'}
          className="hsn-mm__strip"
          onClose={() => setMessage(null)}
        >
          {message.text}
          {message.type === 'success' && (
            <> <Link to="/review" className="hsn-mm__link">Open Review Workbench</Link></>
          )}
        </MessageStrip>
      )}

      <form onSubmit={handleSubmit} className="hsn-mm__form">
        <div className="hsn-mm__identity">
          {field('Material', 'Material', { required: true, size: 'lg' })}
          {field('Description', 'Material_Description', { required: true, size: 'xl' })}
        </div>

        <SapSection title="General Data" subtitle="Core material attributes">
          <div className="hsn-mm__columns">
            <div className="hsn-mm__col">
              {field('Base Unit of Measure', 'Legacy_Field_Value', { options: BASE_UNITS, size: 'xs', hint: formData.Legacy_Field_Value || undefined })}
              {field('Old material number', 'Old_material_number', { size: 'md' })}
              {field('Material Type', 'Material_Type', { required: true, options: MATERIAL_TYPES, size: 'sm' })}
              {field('Company Code', 'Legacy_Company_Code', { size: 'sm' })}
              {field('Process Flag', 'Process_Flag', { size: 'xs' })}
            </div>
            <div className="hsn-mm__col">
              {field('Material Group', 'Material_Group', { required: true, size: 'sm' })}
              {field('Plant', 'ZZ1_MM_RP_PLT', { size: 'sm' })}
              {field('Manufacturer Part No.', 'Manufacturer_Part_No_', { size: 'md' })}
              {field('Valuation Class', 'Valuation_Class', { size: 'sm' })}
              {field('Item Plan Type', 'Item_Plan_Type', { size: 'sm' })}
            </div>
          </div>
        </SapSection>

        <SapSection title="Dimensions / Units" subtitle="Weight, volume, display units">
          <div className="hsn-mm__columns">
            <div className="hsn-mm__col">
              {field('Base Unit of Measure', 'Base_Unit_of_Measure', { size: 'xs' })}
              {field('Unit of Weight', 'Unit_of_Weight', { size: 'xs', hint: 'e.g. KG' })}
            </div>
            <div className="hsn-mm__col">
              {field('Volume Unit', 'Volume_Unit', { size: 'xs' })}
              {field('Display Unit', 'Display_Unit_Measure', { size: 'xs' })}
            </div>
          </div>
        </SapSection>

        <SapSection title="Packaging material data">
          <div className="hsn-mm__columns">
            <div className="hsn-mm__col">
              {field('Matl Grp Pack.Matls', 'Material_Group_3', { size: 'sm' })}
            </div>
            <div className="hsn-mm__col">
              {field('Material Group 4', 'Material_Group_4', { size: 'sm' })}
              {field('Loading Group', 'Loading_Group', { size: 'sm' })}
            </div>
          </div>
        </SapSection>

        <SapSection title="Basic Data Texts" subtitle="Descriptions & validity">
          <div className="hsn-mm__columns">
            <div className="hsn-mm__col">
              {field('Description 1', 'Material_Description_1', { size: 'xl' })}
              {field('POTXT', 'POTXT', { size: 'lg' })}
            </div>
            <div className="hsn-mm__col">
              {field('Valid From', 'Valid_From', { size: 'md', hint: 'YYYY-MM-DD' })}
              {field('Storage Location', 'Storage_Location_Extend', { size: 'md' })}
            </div>
          </div>
        </SapSection>

        <SapSection title="Custom data" defaultOpen={false}>
          <div className="hsn-mm__columns">
            <div className="hsn-mm__col">
              {field('Plant type legacy', 'Plant_type_Legacy', { size: 'sm' })}
              {field('Domestic flag', 'DOMESTIC_FLAG', { size: 'xs' })}
            </div>
            <div className="hsn-mm__col">
              {field('No stock check', 'NO_STOCK_CHECK_IND', { size: 'xs' })}
            </div>
          </div>
        </SapSection>

        <SapSection title="Unit conversions" subtitle="Rare — expand only if needed" defaultOpen={false}>
          {ADVANCED_GROUPS.map((group, i) => (
            <div key={i} className="hsn-mm__conv-block">
              {i > 0 && <hr className="hsn-mm__divider" />}
              <div className="hsn-mm__columns">
                <div className="hsn-mm__col">
                  {group.slice(0, Math.ceil(group.length / 2)).map(([key, label]) =>
                    field(label, key, { size: 'xs' }),
                  )}
                </div>
                <div className="hsn-mm__col">
                  {group.slice(Math.ceil(group.length / 2)).map(([key, label]) =>
                    field(label, key, { size: 'xs' }),
                  )}
                </div>
              </div>
            </div>
          ))}
        </SapSection>

        <footer className="hsn-mm__footer">
          <p className="hsn-mm__footer-note">
            Required fields marked <span className="hsn-mm__req">*</span>. Queued materials appear in Review Workbench.
          </p>
          <div className="hsn-mm__footer-actions">
            <button
              type="button"
              className="hsn-btn hsn-btn--ghost"
              onClick={() => {
                setFormData(INITIAL_STATE);
                setErrors({});
                setMessage(null);
              }}
            >
              Clear
            </button>
            <button type="submit" className="hsn-btn hsn-btn--primary" disabled={loading}>
              {loading ? 'Saving…' : 'Add to queue'}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
