import { registerHooks } from "node:module";

// Unit-only seam for steering's synthetic "trip". Real pilot/free policy is covered by DB integration tests.
registerHooks({
  resolve(specifier, context, next) {
    if (/(?:^|\/)goal-access(?:\.ts)?$/.test(specifier)) {
      return { url: "commons-test:pilot-goal-access", format: "commonjs", shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === "commons-test:pilot-goal-access") {
      return { format: "commonjs", source: 'exports.coordinatorGoalsAvailableFor = async (_trip, environment) => environment?.COMMONS_COORDINATOR_GOALS_ENABLED === "true";', shortCircuit: true };
    }
    return next(url, context);
  },
});
