import { Fragment, useState } from 'react';
import { Button, Input, Label, Title, Panel } from '@ui5/webcomponents-react';
import { addLegacyMaterial, rankMaterial } from '../services/odataClient';

const FIELD_DEFAULTS = { Material_Type: 'FERT', HSN: '9999' };

const SECTIONS = [
  {
    title: '1. Primary Identification',
    fields: [
      ['Material', 'Material Number', true],
      ['Material_Description', 'Description', true],
      ['Material_Description_1', 'Description 1'],
      ['Old_material_number', 'Old Material Number'],
      ['Manufacturer_Part_No_', 'Manufacturer Part No'],
    ],
  },
  {
    title: '2. Categorization & Characteristics',
    fields: [
      ['Material_Type', 'Material Type (e.g. FERT)'],
      ['Material_Group', 'Material Group'],
      ['Material_Group_3', 'Material Group 3'],
      ['Material_Group_4', 'Material Group 4'],
      ['Item_Plan_Type', 'Item Plan Type'],
    ],
  },
  {
    title: '3. Organizational & Plant Data',
    fields: [
      ['ZZ1_MM_RP_PLT', 'Plant (ZZ1_MM_RP_PLT)'],
      ['Plant_type_Legacy', 'Plant Type Legacy'],
      ['Legacy_Company_Code', 'Legacy Company Code'],
      ['Storage_Location_Extend', 'Storage Location'],
      ['Loading_Group', 'Loading Group'],
      ['Valuation_Class', 'Valuation Class'],
    ],
  },
  {
    title: '4. Lifecycle & Flags',
    fields: [
      ['Valid_From', 'Valid From (YYYY-MM-DD)'],
      ['Effective_Till_Date', 'Effective Till (YYYY-MM-DD)'],
      ['DOMESTIC_FLAG', 'Domestic Flag'],
      ['NO_STOCK_CHECK_IND', 'No Stock Check Ind'],
      ['Process_Flag', 'Process Flag'],
    ],
  },
  {
    title: '5. Base Units & Weights',
    fields: [
      ['Base_Unit_of_Measure', 'Base Unit of Measure'],
      ['Unit_of_Weight', 'Unit of Weight'],
      ['Volume_Unit', 'Volume Unit'],
    ],
  },
  {
    title: '6. Advanced Unit Conversions',
    collapsed: true,
    fieldGroups: [
      [['Numerator', 'Numerator (Base)'], ['Denominator', 'Denominator (Base)'], ['Display_Unit_Measure', 'Display Unit Measure']],
      [['Base_Unit_of_Measure_1', 'Base Unit 1'], ['Numerator_1', 'Numerator 1'], ['Denominator_1', 'Denominator 1'], ['Display_Unit_Measure_1', 'Display Unit 1']],
      [['Base_Unit_of_Measure_2', 'Base Unit 2'], ['Numerator_2', 'Numerator 2'], ['Denominator_2', 'Denominator 2'], ['Display_Unit_Measure_2', 'Display Unit 2']],
      [['Numerator_3', 'Numerator 3'], ['Denominator_3', 'Denominator 3'], ['Display_Unit_Measure_3', 'Display Unit 3']],
      [['Numerator_4', 'Numerator 4'], ['Denominator_4', 'Denominator 4'], ['Display_Unit_Measure_4', 'Display Unit 4']],
      [['Numerator_5', 'Numerator 5'], ['Denominator_5', 'Denominator 5']],
    ],
  },
  {
    title: '7. Miscellaneous',
    fields: [
      ['Legacy_Field_Value', 'Legacy Field Value'],
      ['POTXT', 'POTXT'],
    ],
  },
];

const PANEL_BODY = { display: 'flex', flexWrap: 'wrap', gap: '1rem', padding: '1rem' };
const GROUP_DIVIDER = { width: '100%', height: '1px', background: '#ccc', margin: '0.5rem 0' };

const INITIAL_STATE = {
  ...Object.fromEntries(
    SECTIONS.flatMap(({ fields, fieldGroups }) =>
      (fields ?? fieldGroups.flat()).map(([key]) => [key, FIELD_DEFAULTS[key] ?? ''])
    )
  ),
  HSN: '9999',
};

export default function IngestionPage() {
  const [formData, setFormData] = useState(INITIAL_STATE);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.Material || !formData.Material_Description) {
      setMessage('Error: Material Number and Description are required.');
      return;
    }

    setLoading(true);
    setMessage('');
    try {
      await addLegacyMaterial({
        ...formData,
        Legacy_Serial_number: `LEGACY-${Date.now()}`
      });
      const material = formData.Material;
      setMessage('Success! Material added to the unclassified legacy queue.');
      setFormData(INITIAL_STATE);
      rankMaterial(material).catch(() => {
        /* ranking runs in background; user can also run batch pipeline */
      });
    } catch (err) {
      setMessage(`Failed to add material: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const renderField = (field, label, required = false) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: '1 1 calc(33.333% - 1rem)', minWidth: '200px' }}>
      <Label required={required}>{label || field}</Label>
      <Input
        value={formData[field]}
        onInput={(e) => handleChange(field, e.target.value)}
        style={{ width: '100%' }}
      />
    </div>
  );

  const renderSectionFields = (section) => {
    if (section.fieldGroups) {
      return section.fieldGroups.map((group, i) => (
        <Fragment key={i}>
          {i > 0 && <div style={GROUP_DIVIDER} />}
          {group.map(([field, label, required]) => renderField(field, label, required))}
        </Fragment>
      ));
    }
    return section.fields.map(([field, label, required]) => renderField(field, label, required));
  };

  const isError = /^(Error|Failed)/.test(message);

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto', background: 'var(--hsn-surface)' }}>
      <Title level="H2" style={{ marginBottom: '0.5rem', color: 'var(--hsn-on-surface)' }}>Ingest Legacy Material</Title>
      <p style={{ color: 'var(--hsn-on-surface-variant)', marginBottom: '2rem' }}>
        Complete the full 46-field legacy form. This item will be ingested into the `ZMM_MAT_LEGACY` table with a dummy HSN of 9999 for AI review.
      </p>

      {message && (
        <div style={{
          marginBottom: '1.5rem', padding: '1rem', borderRadius: '4px', fontWeight: 'bold',
          backgroundColor: isError ? 'var(--hsn-error-container)' : '#dcfce7',
          color: isError ? 'var(--hsn-on-error-container)' : '#166534',
        }}>
          {message}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {SECTIONS.map((section) => (
          <Panel key={section.title} headerText={section.title} collapsed={section.collapsed}>
            <div style={PANEL_BODY}>{renderSectionFields(section)}</div>
          </Panel>
        ))}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2rem' }}>
          <Button design="Emphasized" type="Submit" disabled={loading} style={{ width: '200px' }}>
            {loading ? 'Ingesting...' : 'Ingest Material'}
          </Button>
        </div>
      </form>
    </div>
  );
}
