import { useState, useEffect } from 'react';
import { approveHsn, submitManualHsn } from '../services/odataClient';
import StatusBadge from './StatusBadge';

/**
 * MaterialDetailDrawer — right-side panel with full material context.
 *
 * Renders:
 *   • Header: Material ID (monospace), description, status badge
 *   • Metadata grid: Type, Category, Group, Plant, Reviewed by, Last Modified
 *   • 3 HSN candidate cards side-by-side with confidence bar + source
 *   • Manual override section (always visible, not collapsed)
 *   • Footer: Edit (ghost) | Approve (green)
 *
 * Props:
 *   material     material object | null
 *   onClose      () => void
 *   onApproved   (materialId, hsn) => void
 */
export default function MaterialDetailDrawer({ material, onClose, onApproved }) {
  const [manualHsn, setManualHsn]     = useState('');
  const [manualReason, setManualReason] = useState('');
  const [loading, setLoading]         = useState(false);
  const [feedback, setFeedback]       = useState(null); // { type: 'success'|'error', msg }

  useEffect(() => {
    if (material) {
      setManualHsn('');
      setManualReason('');
      setFeedback(null);
    }
  }, [material?.materialId]);

  // Trap Escape key
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!material) return null;

  const topHsn = material.hsnCandidates?.[0]?.hsn;

  const handleApprove = async () => {
    const hsn = manualHsn.trim() || topHsn;
    if (!hsn) return;
    setLoading(true);
    setFeedback(null);
    try {
      if (manualHsn.trim()) {
        await submitManualHsn(material.materialId, manualHsn.trim(), manualReason || 'Manual override');
      } else {
        await approveHsn(material.materialId, hsn);
      }
      setFeedback({ type: 'success', msg: `HSN ${hsn} approved for ${material.materialId}` });
      onApproved?.(material.materialId, hsn);
    } catch {
      setFeedback({ type: 'error', msg: 'Approval failed. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const rankLabel = ['1st', '2nd', '3rd'];

  const confidenceBarColor = (conf) => {
    if (conf >= 0.85) return '#16a34a';
    if (conf >= 0.65) return '#d97706';
    return '#dc2626';
  };

  const formatDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  };

  return (
    <div className="hsn-drawer-overlay" role="presentation" onClick={onClose}>
      <aside
        className="hsn-drawer"
        role="complementary"
        aria-label={`Material detail: ${material.materialId}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="hsn-drawer__header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="hsn-drawer__mat-id">{material.materialId}</span>
              <StatusBadge status={material.status} />
            </div>
            <div className="hsn-drawer__mat-desc">{material.description}</div>
          </div>
          <button
            className="hsn-drawer__header-close"
            onClick={onClose}
            aria-label="Close drawer"
            type="button"
          >
            ✕
          </button>
        </div>

        {/* ── Body ── */}
        <div className="hsn-drawer__body">

          {/* Metadata grid */}
          <section>
            <div className="hsn-drawer__section-title">Material Information</div>
            <div className="hsn-meta-grid">
              {[
                { label: 'Material Type', value: material.materialType, code: true },
                { label: 'Category',      value: material.category },
                { label: 'Group',         value: material.group },
                { label: 'Plant',         value: material.plant, code: true },
                { label: 'Reviewed By',   value: material.reviewedBy ?? 'Not yet reviewed' },
                { label: 'Last Modified', value: formatDate(material.lastModified) },
              ].map(({ label, value, code }) => (
                <div key={label}>
                  <div className="hsn-meta-item__label">{label}</div>
                  <div className={code ? 'hsn-meta-item__value hsn-meta-item__value--code' : 'hsn-meta-item__value'}>
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* HSN Candidates */}
          <section>
            <div className="hsn-drawer__section-title">HSN Candidates</div>
            <div className="hsn-candidates">
              {material.hsnCandidates?.map((c, idx) => (
                <div
                  key={c.hsn}
                  className={`hsn-candidate-card ${idx === 0 ? 'hsn-candidate-card--top' : ''}`}
                >
                  <div className="hsn-candidate-card__rank">
                    {rankLabel[idx]} choice
                    {idx === 0 && <span style={{ marginLeft: 4, color: '#16a34a' }}>★ Top</span>}
                  </div>
                  <div className="hsn-candidate-card__hsn">{c.hsn}</div>
                  <div className="hsn-candidate-card__bar-wrap">
                    <div
                      className="hsn-candidate-card__bar"
                      style={{
                        width: `${Math.round(c.confidence * 100)}%`,
                        background: confidenceBarColor(c.confidence),
                      }}
                    />
                  </div>
                  <div className="hsn-candidate-card__confidence">
                    {Math.round(c.confidence * 100)}% confidence
                  </div>
                  <div className="hsn-candidate-card__source">{c.source}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Manual Override — always visible */}
          <section>
            <div className="hsn-drawer__section-title">Manual Override</div>
            <div className="hsn-override">
              <div className="hsn-override__row">
                <div className="hsn-override__input-wrap">
                  <div className="hsn-override__label">HSN Code</div>
                  <input
                    id={`drawer-manual-hsn-${material.materialId}`}
                    type="text"
                    className="hsn-override__input"
                    placeholder="8-digit HSN code…"
                    value={manualHsn}
                    maxLength={8}
                    onChange={(e) => setManualHsn(e.target.value.replace(/\D/g, ''))}
                    aria-label="Manual HSN override code"
                  />
                </div>
              </div>
              <div>
                <div className="hsn-override__label">Reason / Justification</div>
                <textarea
                  id={`drawer-manual-reason-${material.materialId}`}
                  className="hsn-override__textarea"
                  placeholder="Provide audit justification for the override…"
                  value={manualReason}
                  onChange={(e) => setManualReason(e.target.value)}
                  aria-label="Override reason"
                />
              </div>
            </div>
          </section>

          {/* Feedback message */}
          {feedback && (
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 4,
                fontSize: 13,
                fontWeight: 500,
                background: feedback.type === 'success' ? '#dcfce7' : '#fee2e2',
                color:      feedback.type === 'success' ? '#166534' : '#991b1b',
                border:     `1px solid ${feedback.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
              }}
              role="status"
            >
              {feedback.msg}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="hsn-drawer__footer">
          <div className="hsn-drawer__footer-left">
            {material.reviewedBy
              ? `Last reviewed by ${material.reviewedBy}`
              : 'Not yet reviewed'}
          </div>
          <div className="hsn-drawer__footer-actions">
            <button
              className="hsn-btn hsn-btn--ghost"
              onClick={onClose}
              disabled={loading}
              type="button"
            >
              Edit Later
            </button>
            <button
              className="hsn-btn hsn-btn--approve"
              onClick={handleApprove}
              disabled={loading}
              type="button"
              aria-label={`Approve HSN ${manualHsn.trim() || topHsn} for ${material.materialId}`}
            >
              {loading ? 'Approving…' : `Approve${manualHsn.trim() ? ' Override' : ''}`}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
