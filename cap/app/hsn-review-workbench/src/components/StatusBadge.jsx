/**
 * StatusBadge — maps material status to a styled pill.
 *
 * Statuses:
 *   Approved  → green  (low-saturation, enterprise tone)
 *   AI-Assist → amber  (reserved for AI-driven suggestions)
 *   Pending   → blue
 *   Flagged   → red
 */
export default function StatusBadge({ status }) {
  const classMap = {
    'Approved':  'hsn-status hsn-status--approved',
    'AI-Assist': 'hsn-status hsn-status--ai-assist',
    'Pending':   'hsn-status hsn-status--pending',
    'Flagged':   'hsn-status hsn-status--flagged',
  };

  const labelMap = {
    'Approved':  'Approved',
    'AI-Assist': 'AI Assist',
    'Pending':   'Pending Review',
    'Flagged':   'Flagged',
  };

  const dotMap = {
    'Approved':  '●',
    'AI-Assist': '◆',
    'Pending':   '○',
    'Flagged':   '▲',
  };

  return (
    <span className={classMap[status] ?? 'hsn-status hsn-status--pending'}>
      <span aria-hidden="true">{dotMap[status] ?? '○'}</span>
      {labelMap[status] ?? status}
    </span>
  );
}
