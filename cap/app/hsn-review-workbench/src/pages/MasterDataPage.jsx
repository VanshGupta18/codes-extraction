import { useState, useEffect } from 'react';
import { Label, Title, Button, FilterBar, FilterGroupItem, Input, Option, Select } from '@ui5/webcomponents-react';
import { fetchAllMasterData } from '../services/odataClient';

export default function MasterDataPage() {
  const [data, setData] = useState([]);
  const [filteredData, setFilteredData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('All'); // All, Pending, Approved
  const [searchQuery, setSearchQuery] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const items = await fetchAllMasterData();
      setData(items);
      applyFilters(items, filterType, searchQuery);
    } catch (err) {
      console.error('Failed to load master data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const applyFilters = (items, type, query) => {
    let result = items;
    
    // Status Filter
    if (type === 'Pending') {
      result = result.filter(item => item.HSN === '9999');
    } else if (type === 'Approved') {
      result = result.filter(item => item.HSN !== '9999');
    }

    // Search query
    if (query) {
      const lower = query.toLowerCase();
      result = result.filter(item => 
        (item.Material && item.Material.toLowerCase().includes(lower)) ||
        (item.Material_Description && item.Material_Description.toLowerCase().includes(lower)) ||
        (item.HSN && item.HSN.includes(lower))
      );
    }

    setFilteredData(result);
  };

  const handleFilterTypeChange = (e) => {
    const type = e.detail.selectedOption.value;
    setFilterType(type);
    applyFilters(data, type, searchQuery);
  };

  const handleSearchChange = (e) => {
    const q = e.target.value;
    setSearchQuery(q);
    applyFilters(data, filterType, q);
  };

  return (
    <div style={{ padding: '1rem', background: 'var(--hsn-surface)', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level="H3">Material Master Explorer</Title>
        <Button onClick={loadData} disabled={loading} design="Transparent" icon="refresh">
          Refresh Data
        </Button>
      </div>

      <FilterBar
        hideFilterConfiguration
        style={{ marginBottom: '1rem' }}
        onGo={() => applyFilters(data, filterType, searchQuery)}
      >
        <FilterGroupItem label="Classification Status">
          <Select onChange={handleFilterTypeChange}>
            <Option value="All" selected={filterType === 'All'}>All Materials</Option>
            <Option value="Pending" selected={filterType === 'Pending'}>Pending (Dummy HSN)</Option>
            <Option value="Approved" selected={filterType === 'Approved'}>Approved</Option>
          </Select>
        </FilterGroupItem>
        <FilterGroupItem label="Search">
          <Input 
            placeholder="Material or Description..." 
            value={searchQuery}
            onInput={handleSearchChange}
          />
        </FilterGroupItem>
      </FilterBar>

      <div style={{ flex: 1, overflow: 'auto', background: 'var(--hsn-surface-container-lowest)', borderRadius: '8px' }}>
        <table className="hsn-table">
          <thead>
            <tr>
              <th>Material</th>
              <th>Description</th>
              <th>Material Group</th>
              <th>Plant</th>
              <th>HSN Code</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
          {loading && (
            <tr>
              <td colSpan={6} style={{ padding: '20px', textAlign: 'center' }}>Loading master data...</td>
            </tr>
          )}
          
          {!loading && filteredData.length === 0 && (
            <tr>
              <td colSpan={6} style={{ padding: '20px', textAlign: 'center' }}>No materials found.</td>
            </tr>
          )}

          {!loading && filteredData.map(item => {
            const isApproved = item.HSN !== '9999';
            return (
              <tr key={item.Legacy_Serial_number}>
                <td>{item.Material}</td>
                <td>{item.Material_Description}</td>
                <td>{item.Material_Group}</td>
                <td>{item.ZZ1_MM_RP_PLT}</td>
                <td>
                  <span style={{ fontWeight: 'bold', color: isApproved ? 'var(--hsn-primary)' : 'var(--hsn-on-surface-variant)' }}>
                    {item.HSN}
                  </span>
                </td>
                <td>
                  <span style={{ 
                    padding: '2px 8px', 
                    borderRadius: '12px', 
                    fontSize: '12px',
                    fontWeight: 500,
                    backgroundColor: isApproved ? 'var(--hsn-primary-container)' : 'var(--hsn-surface-container-highest)',
                    color: isApproved ? 'var(--hsn-on-primary-container)' : 'var(--hsn-on-surface)'
                  }}>
                    {isApproved ? 'Approved' : 'Pending Review'}
                  </span>
                </td>
              </tr>
            );
          })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
