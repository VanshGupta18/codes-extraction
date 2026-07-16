import { useState, useEffect, useCallback } from 'react';
import { fetchMaterialQueue, bulkApprove, triggerBatchPipeline } from '../services/odataClient';
import { Avatar, Tag, MultiComboBox, MultiComboBoxItem, Button } from '@ui5/webcomponents-react';
import '@ui5/webcomponents-icons/dist/question-mark.js';
import StatusBadge from './StatusBadge';
import HsnCell from './HsnCell';
import MaterialDetailDrawer from './MaterialDetailDrawer';

const PAGE_SIZE = 10;

const STATUS_OPTIONS = ['All', 'AI-Assist', 'Pending', 'Approved', 'Flagged'];
const TYPE_OPTIONS   = ['All Types', 'FERT', 'ROH', 'HALB'];

/**
 * MaterialQueueTable — main queue screen.
 *
 * Features:
 *   • Loads material queue via odataClient.fetchMaterialQueue()
 *   • Checkbox multi-select column
 *   • Row click → opens MaterialDetailDrawer (HSN pill click does NOT trigger this)
 *   • Bulk "Approve Selected" action bar (visible when ≥1 row checked)
 *   • Status filter + type filter
 *   • Simple numbered pagination (PAGE_SIZE rows/page)
 */
export default function MaterialQueueTable({ onDataLoaded }) {
  const [materials, setMaterials]     = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);

  // Selection
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Detail drawer
  const [drawerMaterial, setDrawerMaterial] = useState(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState([]);
  const [typeFilter, setTypeFilter]     = useState([]);
  const [search, setSearch]             = useState('');

  // Pagination
  const [page, setPage] = useState(1);

  // Bulk state
  const [bulkLoading, setBulkLoading] = useState(false);
  const [batchJobTriggering, setBatchJobTriggering] = useState(false);
  
  // ── Load data ──────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // TODO: Pass filter params to OData query when real endpoints exist
      const data = await fetchMaterialQueue();
      setMaterials(data);
      if (onDataLoaded) onDataLoaded(data.length);
    } catch (e) {
      setError('Failed to load material queue. ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Filtering ──────────────────────────────────────────────
  const filtered = materials.filter((m) => {
    const statusOk = statusFilter.length === 0 || statusFilter.includes(m.status);
    const typeOk   = typeFilter.length === 0 || typeFilter.includes(m.materialType);
    const searchOk = !search || [m.materialId, m.description, m.category, m.hsnCandidates?.[0]?.hsn, m.reviewedBy]
      .some((f) => f?.toLowerCase().includes(search.toLowerCase()));
    return statusOk && typeOk && searchOk;
  });

  // ── Pagination ─────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const setPageSafe = (p) => setPage(Math.max(1, Math.min(p, totalPages)));

  // ── Selection ──────────────────────────────────────────────
  const isAllPageSelected = pageItems.length > 0 &&
    pageItems.every((m) => selectedIds.has(m.materialId));

  const toggleRow = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAllPage = () => {
    if (isAllPageSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        pageItems.forEach((m) => next.delete(m.materialId));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        pageItems.forEach((m) => next.add(m.materialId));
        return next;
      });
    }
  };

  // ── HSN applied callback ───────────────────────────────────
  const handleHsnApplied = (materialId, hsn) => {
    setMaterials((prev) =>
      prev.map((m) =>
        m.materialId === materialId
          ? { ...m, status: 'Approved', hsnCandidates: [{ hsn, confidence: 1.0, source: 'Manual' }, ...m.hsnCandidates.slice(1)] }
          : m
      )
    );
  };

  // ── Bulk approve ───────────────────────────────────────────
  const handleBulkApprove = async () => {
    setBulkLoading(true);
    try {
      const ids = [...selectedIds];
      await bulkApprove(ids);
      setMaterials((prev) =>
        prev.map((m) => selectedIds.has(m.materialId) ? { ...m, status: 'Approved' } : m)
      );
      setSelectedIds(new Set());
    } finally {
      setBulkLoading(false);
    }
  };

  // ── Row click ──────────────────────────────────────────────
  const handleRowClick = (material) => {
    setDrawerMaterial(material);
  };

  const formatDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const handleRunBatch = async () => {
    setBatchJobTriggering(true);
    try {
      await triggerBatchPipeline();
      alert("Batch Pipeline triggered successfully! It is running in the background. Please wait a few moments and click Refresh to see the AI suggestions appear.");
    } catch (e) {
      alert("Failed to trigger batch job: " + e.message);
    } finally {
      setBatchJobTriggering(false);
    }
  };

  return (
    <>
      {/* ── Page Header ── */}
      <div className="hsn-page-header">
        <div>
          <h1 className="hsn-page-header__title">Material Classification Queue</h1>
          <div className="hsn-page-header__subtitle">
            {filtered.length} material{filtered.length !== 1 ? 's' : ''} — review and approve AI-proposed HSN codes
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="hsn-btn hsn-btn--ghost" onClick={handleRunBatch} disabled={batchJobTriggering} type="button" style={{ border: '1px solid var(--hsn-primary)', color: 'var(--hsn-primary)' }}>
            {batchJobTriggering ? 'Triggering...' : '▶ Run Batch Pipeline'}
          </button>
          <button className="hsn-btn hsn-btn--ghost" onClick={loadData} type="button">
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* ── Filter Bar ── */}
      <div className="hsn-filter-bar">
        <span className="hsn-filter-bar__label">Filters</span>

        <input
          id="hsn-search"
          type="search"
          placeholder="Search ID, description, category…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          style={{
            height: 30, padding: '0 10px', border: '1px solid var(--hsn-outline-variant)',
            borderRadius: 4, fontFamily: 'var(--hsn-font-body)', fontSize: 13,
            width: 240, background: 'var(--hsn-surface-container-lowest)',
            color: 'var(--hsn-on-surface)', outline: 'none',
          }}
          aria-label="Search materials"
        />

        <MultiComboBox
          placeholder={statusFilter.length > 0 ? `Status: All (${statusFilter.length})` : 'Status: All'}
          onSelectionChange={(e) => {
            setStatusFilter(e.detail.items.map(i => i.text));
            setPage(1);
          }}
          style={{ width: 180, height: 30 }}
        >
          {STATUS_OPTIONS.filter(s => s !== 'All').map(s => (
            <MultiComboBoxItem key={s} text={s} selected={statusFilter.includes(s)} />
          ))}
        </MultiComboBox>

        <MultiComboBox
          placeholder={typeFilter.length > 0 ? `Type: All (${typeFilter.length})` : 'Type: All'}
          onSelectionChange={(e) => {
            setTypeFilter(e.detail.items.map(i => i.text));
            setPage(1);
          }}
          style={{ width: 180, height: 30 }}
        >
          {TYPE_OPTIONS.filter(t => t !== 'All Types').map(t => (
            <MultiComboBoxItem key={t} text={t} selected={typeFilter.includes(t)} />
          ))}
        </MultiComboBox>

        {(statusFilter.length > 0 || typeFilter.length > 0 || search) && (
          <button
            className="hsn-btn hsn-btn--ghost"
            style={{ height: 30, padding: '0 10px', fontSize: 12 }}
            onClick={() => { setStatusFilter([]); setTypeFilter([]); setSearch(''); setPage(1); }}
            type="button"
          >
            Clear
          </button>
        )}
      </div>

      {/* ── Bulk Action Bar — visible only when rows selected ── */}
      {selectedIds.size > 0 && (
        <div className="hsn-bulk-bar" role="toolbar" aria-label="Bulk actions">
          <span className="hsn-bulk-bar__text">
            {selectedIds.size} material{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
            <Button
              design="Transparent"
              onClick={() => {}}
              style={{ color: '#ffffff', borderColor: '#ffffff', border: '1px solid', height: 30 }}
            >
              Assign to me
            </Button>
            <Button
              design="Emphasized"
              onClick={handleBulkApprove}
              disabled={bulkLoading}
              style={{ background: '#ffffff', color: 'var(--hsn-primary-container)', height: 30 }}
            >
              {bulkLoading ? 'Approving…' : `Approve Selected (${selectedIds.size})`}
            </Button>
          </div>
        </div>
      )}

      {/* ── Table ── */}
      <div className="hsn-table-shell">
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--hsn-on-surface-variant)' }}>
            Loading materials…
          </div>
        ) : error ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--hsn-error)' }}>{error}</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--hsn-on-surface-variant)' }}>
            No materials match the current filters.
          </div>
        ) : (
          <>
            <table className="hsn-table" aria-label="Material classification queue">
              <thead>
                <tr>
                  <th scope="col" aria-label="Select">
                    <input
                      type="checkbox"
                      className="hsn-checkbox"
                      checked={isAllPageSelected}
                      onChange={toggleAllPage}
                      aria-label="Select all on this page"
                      id="select-all-checkbox"
                    />
                  </th>
                  <th scope="col">Material ID</th>
                  <th scope="col">Description</th>
                  <th scope="col">Material Type</th>
                  <th scope="col">Category</th>
                  <th scope="col">HSN</th>
                  <th scope="col">Reviewed By</th>
                  <th scope="col">Last Modified</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((m) => (
                  <tr
                    key={m.materialId}
                    onClick={() => handleRowClick(m)}
                    className={selectedIds.has(m.materialId) ? 'hsn-row--selected' : ''}
                    aria-selected={selectedIds.has(m.materialId)}
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleRowClick(m); }}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="hsn-checkbox"
                        checked={selectedIds.has(m.materialId)}
                        onChange={() => toggleRow(m.materialId)}
                        aria-label={`Select ${m.materialId}`}
                        id={`chk-${m.materialId}`}
                      />
                    </td>
                    <td className="hsn-cell--id">{m.materialId}</td>
                    <td className="hsn-cell--desc" title={m.description}>{m.description}</td>
                    <td className="hsn-cell--dim">
                      <span className="hsn-type-badge">{m.materialType}</span>
                    </td>
                    <td className="hsn-cell--dim">{m.category}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <HsnCell material={m} onApplied={handleHsnApplied} />
                    </td>
                    <td className="hsn-cell--dim">
                      {m.reviewedBy ? (
                        <span>{m.reviewedBy}</span>
                      ) : (
                        <div className="hsn-assign-wrapper">
                          <span className="hsn-assign-link" style={{ color: 'var(--hsn-primary)', cursor: 'pointer', fontSize: '12px' }}>Assign to me</span>
                        </div>
                      )}
                    </td>
                    <td className="hsn-cell--dim">{formatDate(m.lastModified)}</td>
                    <td><StatusBadge status={m.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* ── Pagination ── */}
            <div className="hsn-pagination">
              <span>
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="hsn-pagination__controls" role="navigation" aria-label="Pagination">
                <button
                  className="hsn-pagination__btn"
                  onClick={() => setPageSafe(1)}
                  disabled={currentPage === 1}
                  aria-label="First page"
                  type="button"
                >«</button>
                <button
                  className="hsn-pagination__btn"
                  onClick={() => setPageSafe(currentPage - 1)}
                  disabled={currentPage === 1}
                  aria-label="Previous page"
                  type="button"
                >‹</button>

                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => Math.abs(p - currentPage) <= 2)
                  .map((p) => (
                    <button
                      key={p}
                      className={`hsn-pagination__btn ${p === currentPage ? 'hsn-pagination__btn--active' : ''}`}
                      onClick={() => setPageSafe(p)}
                      aria-label={`Page ${p}`}
                      aria-current={p === currentPage ? 'page' : undefined}
                      type="button"
                    >
                      {p}
                    </button>
                  ))}

                <button
                  className="hsn-pagination__btn"
                  onClick={() => setPageSafe(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  aria-label="Next page"
                  type="button"
                >›</button>
                <button
                  className="hsn-pagination__btn"
                  onClick={() => setPageSafe(totalPages)}
                  disabled={currentPage === totalPages}
                  aria-label="Last page"
                  type="button"
                >»</button>
              </div>
              <span>{PAGE_SIZE} per page</span>
            </div>
          </>
        )}
      </div>

      {/* ── Detail Drawer ── */}
      <MaterialDetailDrawer
        material={drawerMaterial}
        onClose={() => setDrawerMaterial(null)}
        onApproved={(matId, hsn) => {
          handleHsnApplied(matId, hsn);
          setDrawerMaterial(null);
        }}
      />
    </>
  );
}
