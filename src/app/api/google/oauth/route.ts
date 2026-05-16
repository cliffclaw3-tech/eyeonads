import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/google/oauth
 *
 * Initiates the Google Ads OAuth flow.
 *
 * REQUIRED SETUP:
 * 1. Go to console.cloud.google.com
 * 2. Create or select a project
 * 3. Enable the "Google Ads API"
 * 4. Go to "APIs & Services > Credentials"
 * 5. Create OAuth 2.0 Client ID (type: "Web Application")
 * 6. Add authorized redirect URI:
 *    https://yourdomain.com/api/google/callback
 * 7. Copy Client ID and Secret to .env.local as:
 *    GOOGLE_CLIENT_ID=your_client_id
 *    GOOGLE_CLIENT_SECRET=your_client_secret
 */
export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? `https://${request.headers.get("host")}`;
  const redirectUri = `${appUrl}/api/google/callback`;

  if (!clientId || clientId === "your-google-client-id-here") {
    return NextResponse.json(
      {
        error: "Google Client ID not configured",
        setup:
          "Set GOOGLE_CLIENT_ID in .env.local. See SETUP.md for instructions.",
      },
      { status: 503 }
    );
  }

  const scope = [
    "https://www.googleapis.com/auth/adwords",
    "https://www.googleapis.com/auth/userinfo.email",
  ].join(" ");

  const state = crypto.randomUUID();
  const googleOAuthUrl =
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&state=${state}` +
    `&response_type=code` +
    `&access_type=offline` +
    `&prompt=consent`;

  return NextResponse.redirect(googleOAuthUrl);
}
