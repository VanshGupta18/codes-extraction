import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Input,
  Label,
  MessageStrip,
  Option,
  Panel,
  Select,
  Tag,
  Title,
} from '@ui5/webcomponents-react';
import { addLegacyMaterial, isPendingLegacyMaterial } from '../services/odataClient';

const MATERIAL_TYPES = ['ZICM', 'ZOES', 'ZICN', 'ZDCL'];
const BASE_UNITS = ['', 'NO', 'EA', 'ST', 'KG', 'MM', 'LT'];

const ESSENTIAL_FIELDS = [
  { key: 'Material', label: 'Material number', required: true },
  { key: 'Material_Description', label: 'Description', required: true, wide: true },
  { key: 'Material_Type', label: 'Material type', required: true, select: 'materialType' },
  { key: 'Material_Group', label: 'Material group', required: true },
  { key: 'Legacy_Company_Code', label: 'Company code' },
  { key: 'ZZ1_MM_RP_PLT', label: 'Plant' },
  { key: 'Manufacturer_Part_No_', label: 'Manufacturer part no.' },
  { key: 'Old_material_number', label: 'Old material number' },
  { key: 'Legacy_Field_Value', label: 'Base unit', select: 'baseUnit' },
];

const MORE_FIELDS = [
  ['Material_Description_1', 'Description 1 (override)'],
  ['Process_Flag', 'Process flag'],
  ['Valuation_Class', 'Valuation class'],
  ['POTXT', 'POTXT'],
  ['Item_Plan_Type', 'Item plan type'],
  ['Storage_Location_Extend', 'Storage location'],
  ['Plant_type_Legacy', 'Plant type legacy'],
  ['Loading_Group', 'Loading group'],
  ['Material_Group_3', 'Material group 3'],
  ['Material_Group_4', 'Material group 4'],
  ['Valid_From', 'Valid from (YYYY-MM-DD)'],
  ['DOMESTIC_FLAG', 'Domestic flag'],
  ['NO_STOCK_CHECK_IND', 'No stock check'],
];

const UNIT_FIELDS = [
  ['Base_Unit_of_Measure', 'Base unit of measure'],
  ['Unit_of_Weight', 'Unit of weight'],
  ['Volume_Unit', 'Volume unit'],
  ['Display_Unit_Measure', 'Display unit'],
];

const ADVANCED_GROUPS = [
  [['Numerator_1', 'Numerator 1'], ['Denominator_1', 'Denominator 1'], ['Display_Unit_Measure_1', 'Display unit 1'], ['Base_Unit_of_Measure_1', 'Base unit 1']],
  [['Numerator_2', 'Numerator 2'], ['Denominator_2', 'Denominator 2'], ['Display_Unit_Measure_2', 'Display unit 2'], ['Base_Unit_of_Measure_2', 'Base unit 2']],
  [['Numerator_3', 'Numerator 3'], ['Denominator_3', 'Denominator 3'], ['Display_Unit_Measure_3', 'Display unit 3']],
  [['Numerator_4', 'Numerator 4'], ['Denominator_4', 'Denominator 4'], ['Display_Unit_Measure_4', 'Display unit 4']],
  [['Numerator_5', 'Numerator 5'], ['Denominator_5', 'Denominator 5']],
];

const ALL_KEYS = [
  ...ESSENTIAL_FIELDS.map((f) => f.key),
  ...MORE_FIELDS.map(([k]) => k),
  ...UNIT_FIELDS.map(([k]) => k),
  ...ADVANCED_GROUPS.flat().map(([k]) => k),
];

const INITIAL_STATE = Object.fromEntries(
  ALL_KEYS.map((key) => [key, key === 'Material_Type' ? 'ZICM' : '']),
);

function fieldClass(errors, key, wide = false) {
  const base = errors[key] ? 'hsn-ingestion-field hsn-ingestion-field--error' : 'hsn-ingestion-field';
  return wide ? `${base} hsn-ingestion-field--wide` : base;
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
    for (const { key, required } of ESSENTIAL_FIELDS) {
      if (required && !(formData[key] || '').trim()) {
        next[key] = 'Required';
      }
    }
    const material = formData.Material.trim();
    if (material && !next.Material) {
      const pending = await isPendingLegacyMaterial(material);
      if (pending) next.Material = 'Already pending classification (HSN 9999)';
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

  const renderTextField = (key, label, required = false, wide = false) => (
    <div key={key} className={fieldClass(errors, key, wide)}>
      <Label required={required}>{label}</Label>
      <Input
        value={formData[key]}
        onInput={(ev) => handleChange(key, ev.target.value)}
        className="hsn-ingestion__input"
      />
      {errors[key] && <span className="hsn-ingestion-error">{errors[key]}</span>}
    </div>
  );

  const renderSelect = (key, label, options, required = false) => (
    <div key={key} className={fieldClass(errors, key)}>
      <Label required={required}>{label}</Label>
      <Select
        onChange={(ev) => handleChange(key, ev.detail.selectedOption?.value ?? '')}
        className="hsn-ingestion__input"
      >
        {options.map((opt) => (
          <Option key={opt || 'empty'} value={opt} selected={formData[key] === opt}>
            {opt || '—'}
          </Option>
        ))}
      </Select>
      {errors[key] && <span className="hsn-ingestion-error">{errors[key]}</span>}
    </div>
  );

  const renderEssential = (field) => {
    if (field.select === 'materialType') {
      return renderSelect(field.key, field.label, MATERIAL_TYPES, field.required);
    }
    if (field.select === 'baseUnit') {
      return renderSelect(field.key, field.label, BASE_UNITS, field.required);
    }
    return renderTextField(field.key, field.label, field.required, field.wide);
  };

  return (
    <div className="hsn-ingestion">
      <header className="hsn-ingestion__header">
        <Title level="H2">Add material to classification queue</Title>
        <p>
          Saves to <code>ZMM_MAT_LEGACY</code> with dummy HSN. Batch lookup uses MARA/MAKT and the
          government tariff master to suggest real codes for review.
        </p>
      </header>

      <div className="hsn-ingestion__system" aria-label="System-assigned values">
        <Tag design="Set2" colorScheme="6">HSN 9999</Tag>
        <Tag design="Set2" colorScheme="6">Effective till open</Tag>
        <Tag design="Set2" colorScheme="6">Serial assigned on save</Tag>
      </div>

      {message && (
        <MessageStrip
          design={message.type === 'error' ? 'Negative' : 'Positive'}
          className="hsn-ingestion__strip"
          onClose={() => setMessage(null)}
        >
          {message.text}
          {message.type === 'success' && (
            <>
              {' '}
              <Link to="/review" className="hsn-ingestion__link">Open Review Workbench</Link>
            </>
          )}
        </MessageStrip>
      )}

      <form onSubmit={handleSubmit} className="hsn-ingestion__form">
        <section className="hsn-ingestion__section">
          <Title level="H4">Essentials</Title>
          <p className="hsn-ingestion__hint">
            Description is used for HSN matching. Only these fields are required to queue a material.
          </p>
          <div className="hsn-ingestion__grid">
            {ESSENTIAL_FIELDS.map(renderEssential)}
          </div>
        </section>

        <Panel headerText="More details (optional)" collapsed className="hsn-ingestion__panel">
          <div className="hsn-ingestion__grid hsn-ingestion__panel-body">
            {MORE_FIELDS.map(([key, label]) => renderTextField(key, label))}
          </div>
        </Panel>

        <Panel headerText="Units (optional)" collapsed className="hsn-ingestion__panel">
          <div className="hsn-ingestion__grid hsn-ingestion__panel-body">
            {UNIT_FIELDS.map(([key, label]) => renderTextField(key, label))}
          </div>
        </Panel>

        <Panel headerText="Advanced unit conversions (rare)" collapsed className="hsn-ingestion__panel">
          <div className="hsn-ingestion__panel-body">
            {ADVANCED_GROUPS.map((group, i) => (
              <Fragment key={i}>
                {i > 0 && <hr className="hsn-ingestion__divider" />}
                <div className="hsn-ingestion__grid">
                  {group.map(([key, label]) => renderTextField(key, label))}
                </div>
              </Fragment>
            ))}
          </div>
        </Panel>

        <footer className="hsn-ingestion__footer">
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
            {loading ? 'Saving…' : 'Add to classification queue'}
          </button>
        </footer>
      </form>
    </div>
  );
}
