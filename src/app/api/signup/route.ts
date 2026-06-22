import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createEyeOnAdsSignup, type SupabaseLike } from "@/lib/signup-capture";

export async function POST(request: NextRequest) {
  const result = await createEyeOnAdsSignup(
    await request.json(),
    async () => (await createServiceClient()) as unknown as SupabaseLike
  );

  return NextResponse.json(result.body, { status: result.status });
}
