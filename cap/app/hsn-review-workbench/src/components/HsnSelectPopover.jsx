import { useState, useEffect, useRef } from 'react';
import { approveHsn, submitManualHsn } from '../services/odataClient';

/**
 * HsnSelectPopover
 *
 * A positioned popover rendered at the anchor element's bottom-left.
 * Contains:
 *   • 3 radio-button candidate rows (confidence %, source chip)
 *   • Highest-confidence candidate pre-selected on open
 *   • Always-visible manual HSN entry input (never collapsed)
 *   • Apply (primary) and Cancel (ghost) action buttons
 *
 * Props:
 *   open          boolean
 *   onClose       () => void
 *   anchorRef     React ref to the triggering element (for positioning)
 *   material      full material object
 *   onApplied     (materialId, hsn) => void  — parent refreshes row on success
 */
export default function HsnSelectPopover({ open, onClose, anchorRef, material, onApplied }) {
  const [selectedIdx, setSelectedIdx] = useState(0); // pre-select highest confidence
  const [manualHsn, setManualHsn]     = useState('');
  const [loading, setLoading]         = useState(false);
  const [pos, setPos]                 = useState({ top: 0, left: 0 });
  const popoverRef = useRef(null);

  // Reset selection when popover opens for a different material
  useEffect(() => {
    if (open) {
      setSelectedIdx(0);
      setManualHsn('');
    }
  }, [open, material?.materialId]);

  // Position popover below the anchor element
  useEffect(() => {
    if (open && anchorRef?.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPos({
        top:  rect.bottom + 6,
        left: Math.min(rect.left, window.innerWidth - 340),
      });
    }
  }, [open, anchorRef]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target) &&
        anchorRef?.current && !anchorRef.current.contains(e.target)
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose, anchorRef]);

  if (!open || !material) return null;

  const candidates = material.hsnCandidates ?? [];

  const confidenceClass = (conf) => {
    if (conf >= 0.85) return 'hsn-popover__confidence--high';
    if (conf >= 0.65) return 'hsn-popover__confidence--medium';
    return 'hsn-popover__confidence--low';
  };

  const dotClass = (conf) => {
    if (conf >= 0.85) return 'hsn-pill__dot--high';
    if (conf >= 0.65) return 'hsn-pill__dot--medium';
    return 'hsn-pill__dot--low';
  };

  const handleApply = async () => {
    setLoading(true);
    try {
      const isManual = manualHsn.trim().length > 0;
      const hsn = isManual ? manualHsn.trim() : candidates[selectedIdx]?.hsn;

      if (!hsn) return;

      if (isManual) {
        await submitManualHsn(material.materialId, hsn, 'Manual override via popover');
      } else {
        await approveHsn(material.materialId, hsn);
      }

      onApplied?.(material.materialId, hsn);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      ref={popoverRef}
      className="hsn-popover"
      style={{ position: 'fixed', top: pos.top, left: pos.left }}
      role="dialog"
      aria-modal="true"
      aria-label="Select HSN Code"
    >
      {/* Header */}
      <div className="hsn-popover__header">Select HSN Code</div>

      {/* Candidate radio list */}
      <div className="hsn-popover__candidates" role="radiogroup" aria-label="HSN candidates">
        {candidates.map((c, idx) => (
          <label
            key={c.hsn}
            className={`hsn-popover__candidate ${idx === selectedIdx ? 'hsn-popover__candidate--selected' : ''}`}
            onClick={() => setSelectedIdx(idx)}
          >
            <input
              type="radio"
              className="hsn-popover__radio"
              name={`hsn-candidate-${material.materialId}`}
              checked={idx === selectedIdx}
              onChange={() => setSelectedIdx(idx)}
            />
            <div className="hsn-popover__cand-info">
              <div className="hsn-popover__cand-hsn">{c.hsn}</div>
              <div className="hsn-popover__cand-meta">
                <span className="hsn-popover__source">{c.source}</span>
                <span
                  className={`hsn-popover__confidence ${confidenceClass(c.confidence)}`}
                >
                  <span
                    className={`hsn-pill__dot ${dotClass(c.confidence)}`}
                    style={{ display: 'inline-block', marginRight: 3 }}
                  />
                  {Math.round(c.confidence * 100)}%
                </span>
              </div>
            </div>
          </label>
        ))}
      </div>

      {/* Divider */}
      <div className="hsn-popover__divider" />

      {/* Always-visible manual entry */}
      <div className="hsn-popover__manual">
        <div className="hsn-popover__manual-label">Manual Override</div>
        <input
          id={`hsn-manual-${material.materialId}`}
          type="text"
          className="hsn-popover__manual-input"
          placeholder="Enter any code…"
          value={manualHsn}
          onChange={(e) => setManualHsn(e.target.value)}
          aria-label="Manual code entry"
        />
      </div>

      {/* Action buttons */}
      <div className="hsn-popover__actions">
        <button
          className="hsn-btn hsn-btn--ghost"
          onClick={onClose}
          disabled={loading}
          type="button"
        >
          Cancel
        </button>
        <button
          className="hsn-btn hsn-btn--primary"
          onClick={handleApply}
          disabled={loading}
          type="button"
        >
          {loading ? 'Applying…' : 'Apply'}
        </button>
      </div>
    </div>
  );
}
