// Paid profile analysis policy:
// - first analysis: 10 active public picks
// - legacy reviews generated below 10 picks may receive one immediate upgrade at 10
// - later re-analysis: at least 5 distinct category-level taste changes
// - later paid generations: at most once every 7 days (admins: no elapsed-time limit)
// - 10-minute reservation only prevents duplicate concurrent provider calls
export const PROFILE_AI_CONTRACT_VERSION = 'profile-ai-v7-ten-weekly-admin-bypass';
export const PROFILE_AI_MIN_PICKS = 10;
export const PROFILE_AI_RECOMMENDED_PICKS = 10;
export const PROFILE_AI_MIN_CHANGES = 5;
export const PROFILE_AI_REANALYSIS_INTERVAL_SECONDS = 7 * 24 * 60 * 60;
export const PROFILE_AI_COOLDOWN_SECONDS = 10 * 60;
