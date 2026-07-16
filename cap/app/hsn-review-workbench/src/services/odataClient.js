/**
 * OData Client — HSN Review Workbench
 *
 * All functions use relative-path fetch calls (same-origin: CAP serves this app).
 * In production: /odata/v4/HSNService/<entity>
 * In dev:        Vite proxy forwards /odata → http://localhost:4004
 *
 * TODO: Replace MOCK_DATA and mock return values with real fetch() calls when
 *       CAP endpoints for ZMM_MAT_LEGACY and HSN approval actions are ready.
 */

// ── Mock Data ──────────────────────────────────────────────────────────────
// TODO: Remove MOCK_DATA once CAP exposes real OData reads for ZMM_MAT_LEGACY
//       joined with MARA / MAKT / MARC. Expected endpoint:
//       GET /odata/v4/HSNService/ZMM_MAT_LEGACY?$expand=...
const MOCK_DATA = [
  {
    materialId: 'MAT-00012345',
    materialType: 'FERT',
    description: 'Steering Column Assembly — HB2 Platform',
    category: 'Automotive Parts',
    group: 'Driveline',
    plant: 'GGN1',
    hsnCandidates: [
      { hsn: '87089900', confidence: 0.94, source: 'MARA Match' },
      { hsn: '87089100', confidence: 0.81, source: 'Vector Match' },
      { hsn: '87089990', confidence: 0.67, source: 'AI Core' },
    ],
    status: 'AI-Assist',
    reviewedBy: null,
    lastModified: '2026-07-15T10:30:00Z',
  },
  {
    materialId: 'MAT-00009871',
    materialType: 'ROH',
    description: 'Cold Rolled Steel Sheet 1.2mm Grade DC04',
    category: 'Raw Materials',
    group: 'Steel & Alloys',
    plant: 'MNS2',
    hsnCandidates: [
      { hsn: '72099000', confidence: 0.91, source: 'MARA Match' },
      { hsn: '72089000', confidence: 0.74, source: 'Vector Match' },
      { hsn: '72101200', confidence: 0.58, source: 'AI Core' },
    ],
    status: 'Pending',
    reviewedBy: null,
    lastModified: '2026-07-14T08:15:00Z',
  },
  {
    materialId: 'MAT-00034412',
    materialType: 'HALB',
    description: 'Brake Caliper Assembly — Front LH',
    category: 'Brake System',
    group: 'Safety',
    plant: 'GGN1',
    hsnCandidates: [
      { hsn: '87083000', confidence: 0.88, source: 'MARA Match' },
      { hsn: '87083090', confidence: 0.79, source: 'Vector Match' },
      { hsn: '84839000', confidence: 0.55, source: 'AI Core' },
    ],
    status: 'Approved',
    reviewedBy: 'R.Sharma',
    lastModified: '2026-07-13T14:22:00Z',
  },
  {
    materialId: 'MAT-00056789',
    materialType: 'FERT',
    description: 'Dashboard Instrument Cluster Complete',
    category: 'Electricals',
    group: 'Instrumentation',
    plant: 'GGN1',
    hsnCandidates: [
      { hsn: '90329000', confidence: 0.76, source: 'Vector Match' },
      { hsn: '85272100', confidence: 0.63, source: 'AI Core' },
      { hsn: '90318090', confidence: 0.48, source: 'AI Core' },
    ],
    status: 'Flagged',
    reviewedBy: 'P.Kumar',
    lastModified: '2026-07-12T09:05:00Z',
  },
  {
    materialId: 'MAT-00078023',
    materialType: 'ROH',
    description: 'Aluminium Alloy Casting — Gearbox Housing',
    category: 'Castings',
    group: 'Powertrain',
    plant: 'MNS2',
    hsnCandidates: [
      { hsn: '76069200', confidence: 0.89, source: 'MARA Match' },
      { hsn: '76090000', confidence: 0.72, source: 'Vector Match' },
      { hsn: '84839000', confidence: 0.51, source: 'AI Core' },
    ],
    status: 'AI-Assist',
    reviewedBy: null,
    lastModified: '2026-07-15T16:44:00Z',
  },
  {
    materialId: 'MAT-00091100',
    materialType: 'HALB',
    description: 'Engine Mount Rubber Isolator — K-series',
    category: 'Rubber Components',
    group: 'Engine',
    plant: 'GGN1',
    hsnCandidates: [
      { hsn: '40169310', confidence: 0.85, source: 'MARA Match' },
      { hsn: '40169990', confidence: 0.70, source: 'Vector Match' },
      { hsn: '87087000', confidence: 0.44, source: 'AI Core' },
    ],
    status: 'Pending',
    reviewedBy: null,
    lastModified: '2026-07-16T07:30:00Z',
  },
  {
    materialId: 'MAT-00103456',
    materialType: 'FERT',
    description: 'Air Filter Element — Diesel Turbo',
    category: 'Filtration',
    group: 'Engine',
    plant: 'MNS2',
    hsnCandidates: [
      { hsn: '84212300', confidence: 0.92, source: 'MARA Match' },
      { hsn: '84219900', confidence: 0.77, source: 'Vector Match' },
      { hsn: '84212900', confidence: 0.60, source: 'AI Core' },
    ],
    status: 'AI-Assist',
    reviewedBy: null,
    lastModified: '2026-07-14T11:00:00Z',
  },
  {
    materialId: 'MAT-00125555',
    materialType: 'ROH',
    description: 'Synthetic Engine Oil 5W-30 (Barrel)',
    category: 'Lubricants',
    group: 'Fluids',
    plant: 'GGN1',
    hsnCandidates: [
      { hsn: '27101980', confidence: 0.95, source: 'MARA Match' },
      { hsn: '27101990', confidence: 0.82, source: 'Vector Match' },
      { hsn: '34031900', confidence: 0.55, source: 'AI Core' },
    ],
    status: 'Pending',
    reviewedBy: null,
    lastModified: '2026-07-16T12:05:00Z',
  },
  {
    materialId: 'MAT-00138901',
    materialType: 'FERT',
    description: 'Radiator Assembly — Z-Series Dual Jet',
    category: 'Cooling System',
    group: 'Engine',
    plant: 'GGN1',
    hsnCandidates: [
      { hsn: '87089100', confidence: 0.88, source: 'MARA Match' },
      { hsn: '84195010', confidence: 0.71, source: 'Vector Match' },
      { hsn: '87089900', confidence: 0.63, source: 'AI Core' },
    ],
    status: 'Approved',
    reviewedBy: 'S.Patel',
    lastModified: '2026-07-15T15:20:00Z',
  },
  {
    materialId: 'MAT-00140221',
    materialType: 'HALB',
    description: 'Wiring Harness — Main Cabin',
    category: 'Electricals',
    group: 'Wiring',
    plant: 'MNS2',
    hsnCandidates: [
      { hsn: '85443000', confidence: 0.97, source: 'MARA Match' },
      { hsn: '85444299', confidence: 0.66, source: 'Vector Match' },
      { hsn: '85444999', confidence: 0.42, source: 'AI Core' },
    ],
    status: 'AI-Assist',
    reviewedBy: null,
    lastModified: '2026-07-16T09:45:00Z',
  },
  {
    materialId: 'MAT-00155009',
    materialType: 'ROH',
    description: 'Tempered Glass — Rear Windshield',
    category: 'Glass',
    group: 'Body',
    plant: 'MNS2',
    hsnCandidates: [
      { hsn: '70072190', confidence: 0.84, source: 'MARA Match' },
      { hsn: '70071100', confidence: 0.79, source: 'Vector Match' },
      { hsn: '87082900', confidence: 0.60, source: 'AI Core' },
    ],
    status: 'Flagged',
    reviewedBy: 'A.Desai',
    lastModified: '2026-07-11T14:10:00Z',
  },
  {
    materialId: 'MAT-00160012',
    materialType: 'FERT',
    description: 'Front Bumper Fascia — Unpainted',
    category: 'Body Parts',
    group: 'Exterior',
    plant: 'GGN1',
    hsnCandidates: [
      { hsn: '87082900', confidence: 0.89, source: 'MARA Match' },
      { hsn: '87081090', confidence: 0.81, source: 'Vector Match' },
      { hsn: '39263000', confidence: 0.55, source: 'AI Core' },
    ],
    status: 'Pending',
    reviewedBy: null,
    lastModified: '2026-07-16T11:30:00Z',
  }
];

// ── Read ───────────────────────────────────────────────────────────────────

/**
 * Fetch the materials queue with HSN candidates and status.
 *
 * TODO: Replace with:
 *   const res = await fetch('/odata/v4/HSNService/ZMM_MAT_LEGACY?$expand=...');
 *   const json = await res.json();
 *   return json.value.map(mapODataToMaterial);
 */
export async function fetchMaterialQueue() {
  // Simulate network latency
  await new Promise((r) => setTimeout(r, 350));
  return [...MOCK_DATA];
}

// ── Write ──────────────────────────────────────────────────────────────────

/**
 * Approve an AI-proposed or already-validated HSN for a material.
 *
 * TODO: Replace with:
 *   await fetch(`/odata/v4/HSNService/ZMM_MAT_LEGACY('${materialId}')`, {
 *     method: 'PATCH',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ HSN: hsn }),
 *   });
 *   // or call a CAP action: POST /odata/v4/HSNService/approveHsn
 *
 * @param {string} materialId
 * @param {string} hsn - 8-digit HSN code
 */
export async function approveHsn(materialId, hsn) {
  console.info('[TODO] approveHsn →', { materialId, hsn });
  await new Promise((r) => setTimeout(r, 200));
  return { success: true };
}

/**
 * Submit a manually entered HSN code with an audit reason.
 *
 * TODO: Replace with:
 *   await fetch('/odata/v4/HSNService/submitManualHsn', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ materialId, hsn, reason }),
 *   });
 *
 * @param {string} materialId
 * @param {string} hsn - Manually entered 8-digit HSN code
 * @param {string} reason - Audit trail reason text
 */
export async function submitManualHsn(materialId, hsn, reason) {
  console.info('[TODO] submitManualHsn →', { materialId, hsn, reason });
  await new Promise((r) => setTimeout(r, 200));
  return { success: true };
}

/**
 * Bulk approve a list of materials with their current top HSN candidate.
 *
 * TODO: Replace with batch OData requests or a CAP batch action.
 *
 * @param {string[]} materialIds
 */
export async function bulkApprove(materialIds) {
  console.info('[TODO] bulkApprove →', materialIds);
  await new Promise((r) => setTimeout(r, 300));
  return { success: true, count: materialIds.length };
}
