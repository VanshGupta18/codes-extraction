import { useState } from 'react';
import { Button, Input, Label, Title, Panel } from '@ui5/webcomponents-react';
import { addLegacyMaterial } from '../services/odataClient';

const INITIAL_STATE = {
  Material: '',
  Material_Description: '',
  Material_Description_1: '',
  Old_material_number: '',
  Manufacturer_Part_No_: '',
  
  Material_Type: 'FERT',
  Material_Group: '',
  Material_Group_3: '',
  Material_Group_4: '',
  Item_Plan_Type: '',
  
  ZZ1_MM_RP_PLT: '',
  Plant_type_Legacy: '',
  Legacy_Company_Code: '',
  Storage_Location_Extend: '',
  Loading_Group: '',
  Valuation_Class: '',
  
  Valid_From: '',
  Effective_Till_Date: '',
  DOMESTIC_FLAG: '',
  NO_STOCK_CHECK_IND: '',
  Process_Flag: '',
  
  Unit_of_Weight: '',
  Volume_Unit: '',
  Base_Unit_of_Measure: '',
  
  Numerator: '', Denominator: '', Display_Unit_Measure: '',
  Numerator_1: '', Denominator_1: '', Display_Unit_Measure_1: '', Base_Unit_of_Measure_1: '',
  Numerator_2: '', Denominator_2: '', Display_Unit_Measure_2: '', Base_Unit_of_Measure_2: '',
  Numerator_3: '', Denominator_3: '', Display_Unit_Measure_3: '',
  Numerator_4: '', Denominator_4: '', Display_Unit_Measure_4: '',
  Numerator_5: '', Denominator_5: '',
  
  Legacy_Field_Value: '',
  POTXT: '',
  HSN: '9999'
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
      setMessage('Success! Material added to the unclassified legacy queue.');
      setFormData(INITIAL_STATE);
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

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto', background: 'var(--hsn-surface)' }}>
      <Title level="H2" style={{ marginBottom: '0.5rem', color: 'var(--hsn-on-surface)' }}>Ingest Legacy Material</Title>
      <p style={{ color: 'var(--hsn-on-surface-variant)', marginBottom: '2rem' }}>
        Complete the full 46-field legacy form. This item will be ingested into the `ZMM_MAT_LEGACY` table with a dummy HSN of 9999 for AI review.
      </p>

      {message && (
        <div style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: message.startsWith('Error') || message.startsWith('Failed') ? 'var(--hsn-error-container)' : '#dcfce7', color: message.startsWith('Error') || message.startsWith('Failed') ? 'var(--hsn-on-error-container)' : '#166534', borderRadius: '4px', fontWeight: 'bold' }}>
          {message}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        
        <Panel headerText="1. Primary Identification" expanded>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', padding: '1rem' }}>
            {renderField('Material', 'Material Number', true)}
            {renderField('Material_Description', 'Description', true)}
            {renderField('Material_Description_1', 'Description 1')}
            {renderField('Old_material_number', 'Old Material Number')}
            {renderField('Manufacturer_Part_No_', 'Manufacturer Part No')}
          </div>
        </Panel>

        <Panel headerText="2. Categorization & Characteristics" expanded>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', padding: '1rem' }}>
            {renderField('Material_Type', 'Material Type (e.g. FERT)')}
            {renderField('Material_Group', 'Material Group')}
            {renderField('Material_Group_3', 'Material Group 3')}
            {renderField('Material_Group_4', 'Material Group 4')}
            {renderField('Item_Plan_Type', 'Item Plan Type')}
          </div>
        </Panel>

        <Panel headerText="3. Organizational & Plant Data" expanded>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', padding: '1rem' }}>
            {renderField('ZZ1_MM_RP_PLT', 'Plant (ZZ1_MM_RP_PLT)')}
            {renderField('Plant_type_Legacy', 'Plant Type Legacy')}
            {renderField('Legacy_Company_Code', 'Legacy Company Code')}
            {renderField('Storage_Location_Extend', 'Storage Location')}
            {renderField('Loading_Group', 'Loading Group')}
            {renderField('Valuation_Class', 'Valuation Class')}
          </div>
        </Panel>

        <Panel headerText="4. Lifecycle & Flags" expanded>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', padding: '1rem' }}>
            {renderField('Valid_From', 'Valid From (YYYY-MM-DD)')}
            {renderField('Effective_Till_Date', 'Effective Till (YYYY-MM-DD)')}
            {renderField('DOMESTIC_FLAG', 'Domestic Flag')}
            {renderField('NO_STOCK_CHECK_IND', 'No Stock Check Ind')}
            {renderField('Process_Flag', 'Process Flag')}
          </div>
        </Panel>

        <Panel headerText="5. Base Units & Weights" expanded>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', padding: '1rem' }}>
            {renderField('Base_Unit_of_Measure', 'Base Unit of Measure')}
            {renderField('Unit_of_Weight', 'Unit of Weight')}
            {renderField('Volume_Unit', 'Volume Unit')}
          </div>
        </Panel>

        <Panel headerText="6. Advanced Unit Conversions" collapsed>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', padding: '1rem' }}>
            {renderField('Numerator', 'Numerator (Base)')}
            {renderField('Denominator', 'Denominator (Base)')}
            {renderField('Display_Unit_Measure', 'Display Unit Measure')}
            
            <div style={{ width: '100%', height: '1px', background: '#ccc', margin: '0.5rem 0' }} />
            
            {renderField('Base_Unit_of_Measure_1', 'Base Unit 1')}
            {renderField('Numerator_1', 'Numerator 1')}
            {renderField('Denominator_1', 'Denominator 1')}
            {renderField('Display_Unit_Measure_1', 'Display Unit 1')}
            
            <div style={{ width: '100%', height: '1px', background: '#ccc', margin: '0.5rem 0' }} />
            
            {renderField('Base_Unit_of_Measure_2', 'Base Unit 2')}
            {renderField('Numerator_2', 'Numerator 2')}
            {renderField('Denominator_2', 'Denominator 2')}
            {renderField('Display_Unit_Measure_2', 'Display Unit 2')}
            
            <div style={{ width: '100%', height: '1px', background: '#ccc', margin: '0.5rem 0' }} />
            
            {renderField('Numerator_3', 'Numerator 3')}
            {renderField('Denominator_3', 'Denominator 3')}
            {renderField('Display_Unit_Measure_3', 'Display Unit 3')}
            
            <div style={{ width: '100%', height: '1px', background: '#ccc', margin: '0.5rem 0' }} />
            
            {renderField('Numerator_4', 'Numerator 4')}
            {renderField('Denominator_4', 'Denominator 4')}
            {renderField('Display_Unit_Measure_4', 'Display Unit 4')}
            
            <div style={{ width: '100%', height: '1px', background: '#ccc', margin: '0.5rem 0' }} />
            
            {renderField('Numerator_5', 'Numerator 5')}
            {renderField('Denominator_5', 'Denominator 5')}
          </div>
        </Panel>

        <Panel headerText="7. Miscellaneous" expanded>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', padding: '1rem' }}>
            {renderField('Legacy_Field_Value', 'Legacy Field Value')}
            {renderField('POTXT', 'POTXT')}
          </div>
        </Panel>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2rem' }}>
          <Button design="Emphasized" type="Submit" disabled={loading} style={{ width: '200px' }}>
            {loading ? 'Ingesting...' : 'Ingest Material'}
          </Button>
        </div>
      </form>
    </div>
  );
}
