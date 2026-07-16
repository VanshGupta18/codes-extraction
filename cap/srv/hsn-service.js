const cds = require('@sap/cds');

module.exports = cds.service.impl(async function() {
    const { ApprovedClassifications, ZMM_MAT_LEGACY } = this.entities;

    // Trigger the Event Mesh event when a new classification is approved
    this.after('CREATE', 'ApprovedClassifications', async (req) => {
        // Emit event for Python service to pickup for asynchronous indexing
        await this.emit('TariffApproved', {
            MaterialNumber: req.MaterialNumber,
            Description: req.Description,
            ApprovedCode: req.HSN
        });
        
        console.log(`[Event Mesh] Emitted TariffApproved for ${req.MaterialNumber}`);
    });
});
