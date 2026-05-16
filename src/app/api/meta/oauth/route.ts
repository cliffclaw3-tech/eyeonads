import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/meta/oauth
 *
 * Initiates the Meta Ads OAuth flow.
 *
 * REQUIRED SETUP:
 * 1. Go to developers.facebook.com/apps
 * 2. Create a new app of type "Business"
 * 3. Add the "Marketing API" product
 * 4. Under "Facebook Login > Settings", add redirect URI:
 *    https://yourdomain.com/api/meta/callback
 * 5. Copy App ID and App Secret to .env.local as:
 *    META_APP_ID=your_app_id
 *    META_APP_SECRET=your_app_secret
 */
export async function GET(request: NextRequest) {
  const appId = process.env.META_APP_ID;
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? `https://${request.headers.get("host")}`;
  const redirectUri = `${appUrl}/api/meta/callback`;

  if (!appId || appId === "your-meta-app-id-here") {
    return NextResponse.json(
      {
        error: "Meta App ID not configured",
        setup: "Set META_APP_ID in .env.local. See SETUP.md for instructions.",
      },
      { status: 503 }
    );
  }

  const scope = [
    "ads_management",
    "ads_read",
    "business_management",
    "read_insights",
  ].join(",");

  const state = crypto.randomUUID();
  const metaOAuthUrl =
    `https://www.facebook.com/v19.0/dialog/oauth` +
    `?client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&state=${state}` +
    `&response_type=code`;

  return NextResponse.redirect(metaOAuthUrl);
}
