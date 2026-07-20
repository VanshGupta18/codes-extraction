import { useRef, useState } from 'react';
import HsnSelectPopover from './HsnSelectPopover';

/**
 * HsnCell — clickable HSN pill that opens the HSN select popover.
 *
 * CRITICAL: e.stopPropagation() on click prevents the table row's onClick
 * (which opens the Material Detail Drawer) from firing.
 *
 * Props:
 *   material    full material object
 *   onApplied   (materialId, hsn) => void — propagated to parent to update state
 */
export default function HsnCell({ material, onApplied }) {
  const [open, setOpen] = useState(false);
  const pillRef         = useRef(null);

  const top = material.hsnCandidates?.[0];

  const dotClass = material.status === 'Approved'
    ? 'hsn-pill__dot--approved'
    : 'hsn-pill__dot--default';

  const handlePillClick = (e) => {
    // Stop propagation so the table row click does NOT fire
    e.stopPropagation();
    setOpen((prev) => !prev);
  };

  if (!top) return <span className="hsn-text-muted">—</span>;

  return (
    <>
      <button
        ref={pillRef}
        className="hsn-pill"
        onClick={handlePillClick}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`HSN ${top.hsn}, ${Math.round(top.confidence * 100)}% confidence. Click to change.`}
        type="button"
      >
        <span
          className={`hsn-pill__dot ${dotClass}`}
          aria-hidden="true"
        />
        {top.hsn}
        <span className="hsn-pill__chevron" aria-hidden="true">›</span>
      </button>

      <HsnSelectPopover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={pillRef}
        material={material}
        onApplied={(matId, hsn) => {
          setOpen(false);
          onApplied?.(matId, hsn);
        }}
      />
    </>
  );
}
