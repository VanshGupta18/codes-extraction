using { hsn } from '../db/schema';

// Pure SAP connectivity layer: exposes tables as OData. All matching/learning
// logic lives in lookup-service/, not here.
service HSNService {
  entity MARA                    as projection on hsn.MARA;
  entity MAKT                    as projection on hsn.MAKT;
  entity GovtHSNMaster           as projection on hsn.GovtHSNMaster;
  entity GovtSACMaster           as projection on hsn.GovtSACMaster;
  entity ApprovedClassifications as projection on hsn.ApprovedClassifications;
  entity ZMM_MAT_LEGACY          as projection on hsn.ZMM_MAT_LEGACY;
  entity ZMM_MAT_APPROVED        as projection on hsn.ZMM_MAT_APPROVED;
  entity CandidateSuggestions    as projection on hsn.CandidateSuggestions;

  event TariffApproved {
    MaterialNumber: String;
    Description: String;
    ApprovedCode: String;
  }
}
