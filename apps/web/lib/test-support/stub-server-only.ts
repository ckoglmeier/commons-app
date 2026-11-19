import { registerComponentImportStubs } from "./hook-harness";

// Import this first in a test whose module graph reaches `server-only`: the stub must be registered before that module is required.
registerComponentImportStubs();
