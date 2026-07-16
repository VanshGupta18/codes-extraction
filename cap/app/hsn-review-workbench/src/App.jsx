import { useState } from 'react';
import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { Tag } from '@ui5/webcomponents-react';
import './index.css';
import MaterialQueueTable from './components/MaterialQueueTable';
import IngestionPage from './pages/IngestionPage';
import MasterDataPage from './pages/MasterDataPage';
import AnalyticsPage from './pages/AnalyticsPage';

/**
 * App root — Master Data Governance
 */
export default function App() {
  const [itemCount, setItemCount] = useState(0);
  const location = useLocation();

  return (
    <div className="hsn-app">
      {/* Shell header */}
      <header className="hsn-shell-header" role="banner">
        <span className="hsn-shell-header__logo" aria-label="Maruti Suzuki">
          Maruti Suzuki
        </span>
        <div className="hsn-shell-header__divider" aria-hidden="true" />
        <span className="hsn-shell-header__title">Master Data Governance</span>
        
        {/* Navigation Tabs */}
        <nav style={{ marginLeft: '40px', display: 'flex', gap: '20px', alignItems: 'center' }}>
          <Link to="/add" className={`hsn-nav-link ${location.pathname === '/add' ? 'active' : ''}`}>Add Material</Link>
          <Link to="/review" className={`hsn-nav-link ${location.pathname === '/review' ? 'active' : ''}`}>
            Review Workbench
            {itemCount > 0 && <Tag colorScheme="8" style={{ marginLeft: '8px' }}>{itemCount}</Tag>}
          </Link>
          <Link to="/view" className={`hsn-nav-link ${location.pathname === '/view' ? 'active' : ''}`}>Data Explorer</Link>
          <Link to="/analytics" className={`hsn-nav-link ${location.pathname === '/analytics' ? 'active' : ''}`}>Analytics</Link>
        </nav>
      </header>

      {/* Main content */}
      <main className="hsn-main" role="main">
        <Routes>
          <Route path="/" element={<Navigate to="/review" replace />} />
          <Route path="/add" element={<IngestionPage />} />
          <Route path="/review" element={<MaterialQueueTable onDataLoaded={setItemCount} />} />
          <Route path="/view" element={<MasterDataPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
        </Routes>
      </main>
    </div>
  );
}
