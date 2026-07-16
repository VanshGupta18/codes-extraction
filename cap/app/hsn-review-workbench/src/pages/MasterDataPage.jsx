import { useState, useEffect } from 'react';
import { Table, TableColumn, TableRow, TableCell, Label, Title, Button, Bar, FilterBar, FilterGroupItem, Input, Option, Select } from '@ui5/webcomponents-react';
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

      <div style={{ flex: 1, overflow: 'auto' }}>
        <Table
          columns={
            <>
              <TableColumn><Label>Material</Label></TableColumn>
              <TableColumn><Label>Description</Label></TableColumn>
              <TableColumn><Label>Material Group</Label></TableColumn>
              <TableColumn><Label>Plant</Label></TableColumn>
              <TableColumn><Label>HSN Code</Label></TableColumn>
              <TableColumn><Label>Status</Label></TableColumn>
            </>
          }
        >
          {loading && (
            <TableRow>
              <TableCell colSpan={6}><Label>Loading master data...</Label></TableCell>
            </TableRow>
          )}
          
          {!loading && filteredData.length === 0 && (
            <TableRow>
              <TableCell colSpan={6}><Label>No materials found.</Label></TableCell>
            </TableRow>
          )}

          {!loading && filteredData.map(item => {
            const isApproved = item.HSN !== '9999';
            return (
              <TableRow key={item.Legacy_Serial_number}>
                <TableCell><Label>{item.Material}</Label></TableCell>
                <TableCell><Label>{item.Material_Description}</Label></TableCell>
                <TableCell><Label>{item.Material_Group}</Label></TableCell>
                <TableCell><Label>{item.ZZ1_MM_RP_PLT}</Label></TableCell>
                <TableCell>
                  <Label style={{ fontWeight: 'bold', color: isApproved ? 'var(--hsn-primary)' : 'var(--hsn-on-surface-variant)' }}>
                    {item.HSN}
                  </Label>
                </TableCell>
                <TableCell>
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
                </TableCell>
              </TableRow>
            );
          })}
        </Table>
      </div>
    </div>
  );
}
