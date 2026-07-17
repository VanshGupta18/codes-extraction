import { useState } from 'react';
import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import './index.css';
import MaterialQueueTable from './components/MaterialQueueTable';
import IngestionPage from './pages/IngestionPage';
import MasterDataPage from './pages/MasterDataPage';

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
          <img
            src={`${import.meta.env.BASE_URL}logo-mark.svg`}
            alt=""
            className="hsn-shell-header__logo-icon"
            aria-hidden="true"
          />
          Maruti Suzuki
        </span>
        <div className="hsn-shell-header__divider" aria-hidden="true" />
        <span className="hsn-shell-header__title">Master Data Governance</span>
        
        {/* Navigation Tabs */}
        <nav className="hsn-shell-nav" aria-label="Main navigation">
          <Link to="/add" className={`hsn-nav-link ${location.pathname === '/add' ? 'active' : ''}`}>Add Material</Link>
          <Link to="/review" className={`hsn-nav-link ${location.pathname === '/review' ? 'active' : ''}`}>
            Review Workbench
            {itemCount > 0 && <span className="hsn-nav-badge">{itemCount}</span>}
          </Link>
          <Link to="/view" className={`hsn-nav-link ${location.pathname === '/view' ? 'active' : ''}`}>Data Explorer</Link>
        </nav>
      </header>

      {/* Main content */}
      <main className="hsn-main" role="main">
        <Routes>
          <Route path="/" element={<Navigate to="/review" replace />} />
          <Route path="/add" element={<IngestionPage />} />
          <Route path="/review" element={<MaterialQueueTable onDataLoaded={setItemCount} />} />
          <Route path="/view" element={<MasterDataPage />} />
        </Routes>
      </main>
    </div>
  );
}
