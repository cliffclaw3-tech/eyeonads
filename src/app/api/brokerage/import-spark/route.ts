import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchSparkRoster } from "@/lib/spark-roster";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  try {
    if (origin && new URL(origin).host !== host) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  } catch { return NextResponse.json({ error: "Invalid request origin." }, { status: 403 }); }
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in before importing a roster." }, { status: 401 });
  if (!process.env.EYEONADS_SPARK_OWNER_ID || user.id !== process.env.EYEONADS_SPARK_OWNER_ID) return NextResponse.json({ error: "Spark import is available only to the authorized private pilot account." }, { status: 403 });
  const { data: setup, error } = await db.from("eyeonads_brokerage_setups").select("name").eq("owner_id", user.id).maybeSingle();
  if (error) return NextResponse.json({ error: "Your saved brokerage could not be checked. Retry without changing your roster." }, { status: 503 });
  if (!setup) return NextResponse.json({ error: "Save your brokerage setup before importing from Spark." }, { status: 400 });
  try {
    const body = await request.json().catch(() => ({}));
    const officeScope = body?.office_scope ?? "jonesborough";
    if (!["jonesborough", "current-feed"].includes(officeScope)) return NextResponse.json({ error: "Choose Jonesborough or current-feed offices." }, { status: 400 });
    const preview = await fetchSparkRoster(setup.name, officeScope);
    return NextResponse.json(preview, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Spark import could not be completed. Your saved roster is unchanged." }, { status: 503 });
  }
}
