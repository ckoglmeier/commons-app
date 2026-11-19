// Synthetic session for route mechanics only. Never loaded by production code or the browser preview.
exports.readVerifiedSearchIdentity = async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Synchronous Node fixture loads the production constant after module initialization.
  const email = process.env.COMMONS_TEST_SEARCH_EMAIL ?? require('../server/coordinator-search-access').COORDINATOR_SEARCH_OWNER_EMAIL;
  return email && process.env.COMMONS_PILOT_ACTOR_ID ? {authUserId: process.env.COMMONS_PILOT_ACTOR_ID, email} : null;
};
