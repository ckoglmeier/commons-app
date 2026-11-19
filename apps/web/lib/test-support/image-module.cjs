// Test-only stub for `next/image`, whose module touches `document` at import time; see hook-harness.ts.
function Image() { return null; }
module.exports = { __esModule: true, default: Image };
