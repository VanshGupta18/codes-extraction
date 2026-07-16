import { useState } from 'react';
import { Tag } from '@ui5/webcomponents-react';
import './index.css';
import MaterialQueueTable from './components/MaterialQueueTable';

/**
 * App root — HSN Review Workbench
 */
export default function App() {
  const [itemCount, setItemCount] = useState(0);

  return (
    <div className="hsn-app">
      {/* Shell header */}
      <header className="hsn-shell-header" role="banner">
        <span className="hsn-shell-header__logo" aria-label="Maruti Suzuki">
          Maruti Suzuki
        </span>
        <div className="hsn-shell-header__divider" aria-hidden="true" />
        <span className="hsn-shell-header__title">HSN Review Workbench</span>
        {itemCount > 0 && (
          <Tag colorScheme="8" style={{ marginLeft: '12px' }}>
            {itemCount} Items in Queue
          </Tag>
        )}
      </header>

      {/* Main content */}
      <main className="hsn-main" role="main">
        <MaterialQueueTable onDataLoaded={setItemCount} />
      </main>
    </div>
  );
}
