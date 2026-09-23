import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (origin && (!host || new URL(origin).host !== host)) return NextResponse.json({error: "Invalid request origin"}, {status: 403});
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  return new NextResponse(null, {status: 303, headers: {Location: error ? "/dashboard?message=Signout+failed.+Please+retry" : "/login", "Cache-Control": "no-store"}});
}
