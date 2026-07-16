import { useState } from 'react';
import { Button, Input, Label, Select, Option, Title } from '@ui5/webcomponents-react';
import { addLegacyMaterial } from '../services/odataClient';

export default function IngestionPage() {
  const [formData, setFormData] = useState({
    Material: '',
    Material_Description: '',
    Material_Type: 'FERT',
    Material_Group: '',
    ZZ1_MM_RP_PLT: '',
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleChange = (e, field) => {
    setFormData(prev => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.Material || !formData.Material_Description) {
      setMessage('Error: Material and Description are required.');
      return;
    }
    
    setLoading(true);
    setMessage('');
    try {
      await addLegacyMaterial({
        ...formData,
        Legacy_Serial_number: `LEGACY-${Date.now()}` // Generate a unique mock serial for this demo
      });
      setMessage('Success! Material added to the unclassified legacy queue.');
      setFormData({
        Material: '',
        Material_Description: '',
        Material_Type: 'FERT',
        Material_Group: '',
        ZZ1_MM_RP_PLT: '',
      });
    } catch (err) {
      setMessage(`Failed to add material: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto', background: 'var(--hsn-surface)', borderRadius: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
      <Title level="H2" style={{ marginBottom: '1rem', color: 'var(--hsn-on-surface)' }}>Add Material (Ingestion)</Title>
      <p style={{ color: 'var(--hsn-on-surface-variant)', marginBottom: '2rem' }}>
        Add a new unclassified material to the legacy queue. It will automatically be assigned a dummy HSN of '9999'.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Label required>Material Number</Label>
          <Input 
            value={formData.Material} 
            onInput={(e) => handleChange(e, 'Material')} 
            placeholder="e.g. MAT-12345"
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Label required>Description</Label>
          <Input 
            value={formData.Material_Description} 
            onInput={(e) => handleChange(e, 'Material_Description')} 
            placeholder="e.g. ENGINE ASSY, 1.2L"
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
            <Label>Material Type</Label>
            <Select onChange={(e) => setFormData(prev => ({ ...prev, Material_Type: e.detail.selectedOption.value }))}>
              <Option value="FERT" selected={formData.Material_Type === 'FERT'}>FERT</Option>
              <Option value="ROH" selected={formData.Material_Type === 'ROH'}>ROH</Option>
              <Option value="HALB" selected={formData.Material_Type === 'HALB'}>HALB</Option>
            </Select>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
            <Label>Material Group</Label>
            <Input 
              value={formData.Material_Group} 
              onInput={(e) => handleChange(e, 'Material_Group')} 
              placeholder="e.g. 1001"
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
            <Label>Plant</Label>
            <Input 
              value={formData.ZZ1_MM_RP_PLT} 
              onInput={(e) => handleChange(e, 'ZZ1_MM_RP_PLT')} 
              placeholder="e.g. GGN1"
              style={{ width: '100%' }}
            />
          </div>
        </div>

        <div style={{ marginTop: '1rem' }}>
          <Button design="Emphasized" type="Submit" disabled={loading}>
            {loading ? 'Adding...' : 'Add to Queue'}
          </Button>
        </div>

        {message && (
          <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: message.startsWith('Error') || message.startsWith('Failed') ? 'var(--hsn-error-container)' : '#d4edda', color: message.startsWith('Error') || message.startsWith('Failed') ? 'var(--hsn-on-error-container)' : '#155724', borderRadius: '4px' }}>
            {message}
          </div>
        )}
      </form>
    </div>
  );
}
