// Only local preparation of a privately selected dedicated sample target is enabled.
// This never enables OAuth, deploys code, creates resources, runs SQL or stores credentials.
export const productionPolicy = Object.freeze({ sampleOnlyPreparationEnabled: true });
