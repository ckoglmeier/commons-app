import { saveBudgetSnapshot } from '@commons/database';
import { commonsDatabaseUrl } from '@/lib/server/runtime-environment';
import { budgetCaptureHandler } from '@/lib/marketing/budget/capture-route';
export const POST = budgetCaptureHandler({
  enabled: () => process.env.COMMONS_BUDGET_ANALYTICS_ENABLED === 'true' && Boolean(commonsDatabaseUrl()),
  save: input => saveBudgetSnapshot(input, commonsDatabaseUrl()!),
});
