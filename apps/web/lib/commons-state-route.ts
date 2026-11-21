import type { CommonsSnapshot } from "@commons/contracts";
import { NextResponse } from "next/server";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
} from "./server/commons-access-errors";

type StateRouteDependencies = {
  loadSnapshot: (slug: string) => Promise<CommonsSnapshot | null>;
};

export function createCommonsStateRouteHandler({
  loadSnapshot,
}: StateRouteDependencies) {
  return async function commonsStateRoute(
    _request: Request,
    { params }: { params: Promise<{ slug: string }> },
  ) {
    try {
      const { slug } = await params;
      const snapshot = await loadSnapshot(slug);
      if (!snapshot) {
        return NextResponse.json({ error: "Trip not found." }, { status: 404 });
      }

      return NextResponse.json({ snapshot });
    } catch (error) {
      if (error instanceof CommonsAuthenticationRequiredError) {
        return NextResponse.json({ error: error.message }, { status: 401 });
      }
      if (error instanceof CommonsMembershipRequiredError) {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
      return NextResponse.json(
        { error: "Trip not loaded. Try again." },
        { status: 503 },
      );
    }
  };
}
