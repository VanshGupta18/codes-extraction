namespace hsn;

/** SAP General Material Data — no description field in real SAP (see MAKT). */
entity MARA {
  key MaterialNumber : String(18);
      MaterialGroup   : String(9);  // MATKL — reserved for a future scoring signal, not used yet
      MaterialType    : String(4);  // MTART
}

/** SAP Material Descriptions — MAKTX is the actual free text used for matching. */
entity MAKT {
  key MaterialNumber : String(18);
  key Language        : String(2) default 'EN';
      Description      : String(100);
}

/** SAP Plant Data for Material — plant-specific context, not used in matching itself. */
entity MARC {
  key MaterialNumber : String(18);
  key Plant           : String(4);
}

/** Official government HSN tariff master (goods), leaf 8-digit codes, ancestor-enriched. */
entity GovtHSNMaster {
  key Code        : String(8);
      Description : LargeString;  // ancestor-enriched text can run long (observed up to ~2.7K chars)
}

/** Official government SAC master (services), leaf 6-digit codes, ancestor-enriched. */
entity GovtSACMaster {
  key Code        : String(6);
      Description : LargeString;
}

/** Self-learning corpus: every human-approved suggestion becomes a new, high-trust,
 *  exact-company-vocabulary example that future BM25 lookups match against first. */
entity ApprovedClassifications {
  key MaterialNumber : String(18);
      Description     : String(100);
      HSN              : String(8);
      ApprovedAt       : Timestamp;
}

entity CandidateSuggestions {
  key MaterialNumber : String;
  key Rank           : Integer;
  CandidateCode      : String;
  Score              : Decimal(5,2);
}

// HANA Native Vector Storage
entity MaterialEmbeddings {
  key MaterialNumber : String;
  Embedding          : LargeString; // In HANA, this is mapped to REAL_VECTOR(1536) via native HANA SQL or CDS annotations
}

/** Legacy classification queue (dummy HSN 9999 until approved). */
entity ZMM_MAT_LEGACY {
  key MaterialNumber : String(18);
      HSN              : String(8) default '9999';
      ClassifiedAt     : Timestamp;
}
