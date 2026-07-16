namespace hsn;

/** SAP General Material Data */
entity MARA {
  key MaterialNumber : String(40);
      MaterialGroup   : String(9);
      MaterialType    : String(4);
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
  key MaterialNumber : String(40);
      Description     : String(100);
      HSN              : String(8);
      ApprovedAt       : Timestamp;
}

entity CandidateSuggestions {
  key MaterialNumber : String(40);
  key Rank           : Integer;
  CandidateCode      : String;
  Score              : Decimal(5,2);
}

// HANA Native Vector Storage
entity MaterialEmbeddings {
  key MaterialNumber : String(40);
  Embedding          : LargeString; // In HANA, this is mapped to REAL_VECTOR(1536) via native HANA SQL or CDS annotations
}

/** Legacy classification queue (dummy HSN 9999 until approved). */
entity ZMM_MAT_LEGACY {
  Legacy_Serial_number : String;
  Material_Type : String;
  key Material : String(40);
  Material_Description : String;
  Legacy_Field_Value : String;
  Material_Group : String;
  Old_material_number : String;
  Unit_of_Weight : String;
  Material_Description_1 : String;
  Volume_Unit : String;
  Denominator : String;
  Display_Unit_Measure : String;
  Numerator : String;
  Base_Unit_of_Measure : String;
  Denominator_1 : String;
  Numerator_1 : String;
  Denominator_2 : String;
  Display_Unit_Measure_1 : String;
  Numerator_2 : String;
  Base_Unit_of_Measure_1 : String;
  Denominator_3 : String;
  Display_Unit_Measure_2 : String;
  Numerator_3 : String;
  Base_Unit_of_Measure_2 : String;
  DOMESTIC_FLAG : String;
  NO_STOCK_CHECK_IND : String;
  Legacy_Company_Code : String;
  POTXT : String;
  Manufacturer_Part_No_ : String;
  Valid_From : String;
  Loading_Group : String;
  Material_Group_3 : String;
  Valuation_Class : String;
  ZZ1_MM_RP_PLT : String;
  Process_Flag : String;
  Storage_Location_Extend : String;
  Material_Group_4 : String;
  Denominator_4 : String;
  Display_Unit_Measure_3 : String;
  Numerator_4 : String;
  Denominator_5 : String;
  Display_Unit_Measure_4 : String;
  Numerator_5 : String;
  Item_Plan_Type : String;
  Effective_Till_Date : String;
  Plant_type_Legacy : String;
  HSN : String(8) default '9999';
}

/** Final table where approved materials are copied to. */
entity ZMM_MAT_APPROVED {
  Legacy_Serial_number : String;
  Material_Type : String;
  key Material : String(40);
  Material_Description : String;
  Legacy_Field_Value : String;
  Material_Group : String;
  Old_material_number : String;
  Unit_of_Weight : String;
  Material_Description_1 : String;
  Volume_Unit : String;
  Denominator : String;
  Display_Unit_Measure : String;
  Numerator : String;
  Base_Unit_of_Measure : String;
  Denominator_1 : String;
  Numerator_1 : String;
  Denominator_2 : String;
  Display_Unit_Measure_1 : String;
  Numerator_2 : String;
  Base_Unit_of_Measure_1 : String;
  Denominator_3 : String;
  Display_Unit_Measure_2 : String;
  Numerator_3 : String;
  Base_Unit_of_Measure_2 : String;
  DOMESTIC_FLAG : String;
  NO_STOCK_CHECK_IND : String;
  Legacy_Company_Code : String;
  POTXT : String;
  Manufacturer_Part_No_ : String;
  Valid_From : String;
  Loading_Group : String;
  Material_Group_3 : String;
  Valuation_Class : String;
  ZZ1_MM_RP_PLT : String;
  Process_Flag : String;
  Storage_Location_Extend : String;
  Material_Group_4 : String;
  Denominator_4 : String;
  Display_Unit_Measure_3 : String;
  Numerator_4 : String;
  Denominator_5 : String;
  Display_Unit_Measure_4 : String;
  Numerator_5 : String;
  Item_Plan_Type : String;
  Effective_Till_Date : String;
  Plant_type_Legacy : String;
  HSN : String(8);
  ApprovedAt : Timestamp;
}
