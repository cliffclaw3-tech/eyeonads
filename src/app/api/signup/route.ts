import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createEyeOnAdsSignup, type SupabaseLike } from "@/lib/signup-capture";

async function disabledLegacyPOST(request: NextRequest) {
  const result = await createEyeOnAdsSignup(
    await request.json(),
    async () => (await createServiceClient()) as unknown as SupabaseLike
  );

  return NextResponse.json(result.body, { status: result.status });
}

// Account creation is handled by Supabase Auth. Disable the unauthenticated
// service-role capture/email path until verified identity and delivery limits exist.
export async function POST() {
  return NextResponse.json({ error: "Use the signup form to create your account." }, { status: 503 });
}
void disabledLegacyPOST;
