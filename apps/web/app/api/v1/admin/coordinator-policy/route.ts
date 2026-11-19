import { NextResponse } from "next/server";
import { CommonsOperatorRequiredError, requireCommonsOperator } from "@/lib/server/operator";
import { describeCoordinatorPolicies } from "@/lib/server/coordinator-inference-policy";

const headers = { "Cache-Control": "private, no-store" };

/**
 * Operators only: every coordinator inference policy as it resolves right now (which is active, whether it can run and why not, transport, data
 * handling, who pays, routing, and the model for each task). Never returns credentials. Changing the active policy is a deployment setting
 * (COMMONS_COORDINATOR_INFERENCE_POLICY), not a write here.
 */
export async function GET() {
  try {
    await requireCommonsOperator();
    return NextResponse.json(describeCoordinatorPolicies(), { headers });
  } catch (error) {
    if (error instanceof CommonsOperatorRequiredError) return NextResponse.json({ error: "Operator access is required." }, { status: 403, headers });
    // Fixed code only; never configuration values.
    console.warn("commons.admin.coordinator_policy_failed", { reason: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: "Coordinator policies could not be read." }, { status: 500, headers });
  }
}
