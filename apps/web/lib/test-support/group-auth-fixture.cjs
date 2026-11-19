// Node-test-only provider fixture. Never imported by production or local web servers.
let user = null;
let rejected = false;
const verifiedEmails = new Map();
exports.setUser = (value, reject = false) => { user = value; rejected = reject; if (value) verifiedEmails.set(value.id, value.email_confirmed_at ? value.email : null); };
exports.setVerifiedEmail = (id, email) => verifiedEmails.set(id, email);
exports.getSupabaseVerifiedAuthUserEmail = async id => verifiedEmails.get(id) ?? null;
exports.createSupabaseServerClient = async () => ({ auth: { getUser: async () => ({ data: { user }, error: rejected ? new Error('Synthetic rejected session') : null }) } });
exports.getCommonsAuthIdentity = async () => user ? ({ authUserId: user.id, email: user.email, displayName: user.user_metadata?.first_name }) : null;
