// Paid profile analysis policy:
// - first analysis: 5 active public picks
// - one immediate quality upgrade when the profile reaches 10 picks
// - later re-analysis: at least 5 distinct category-level taste changes
// - later paid generations: at most once every 7 days
// - 10-minute reservation only prevents duplicate concurrent provider calls
export const PROFILE_AI_CONTRACT_VERSION = 'profile-ai-v5-five-ten-weekly';
export const PROFILE_AI_MIN_PICKS = 5;
export const PROFILE_AI_RECOMMENDED_PICKS = 10;
export const PROFILE_AI_MIN_CHANGES = 5;
export const PROFILE_AI_REANALYSIS_INTERVAL_SECONDS = 7 * 24 * 60 * 60;
export const PROFILE_AI_COOLDOWN_SECONDS = 10 * 60;
