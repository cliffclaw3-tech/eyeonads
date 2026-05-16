import { NextRequest, NextResponse } from "next/server";
import sgMail from "@sendgrid/mail";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type UserProfile = Database["public"]["Tables"]["user_profiles"]["Row"];
type AdPerformance = Database["public"]["Tables"]["ad_performance"]["Row"];
type ComplianceScan = Database["public"]["Tables"]["compliance_scans"]["Row"];

type WeeklyReportBody = {
  user_id: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as WeeklyReportBody;
    const { user_id } = body;

    if (!user_id) {
      return NextResponse.json({ error: "Missing user_id" }, { status: 400 });
    }

    if (!process.env.SENDGRID_API_KEY) {
      return NextResponse.json(
        { error: "SendGrid API key not configured" },
        { status: 500 }
      );
    }

    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    const supabase = await createClient();

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", user_id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const typedProfile = profile as UserProfile;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: adAccounts } = await supabase
      .from("ad_accounts")
      .select("id, platform, account_name")
      .eq("user_id", user_id);

    const accountIds = (adAccounts ?? []).map((a) => a.id);
    let performance: AdPerformance[] = [];

    if (accountIds.length > 0) {
      const { data: perfData } = await supabase
        .from("ad_performance")
        .select("*")
        .in("ad_account_id", accountIds)
        .gte("date", sevenDaysAgo.toISOString().split("T")[0]);
      performance = (perfData as AdPerformance[]) ?? [];
    }

    const totalSpend = performance.reduce((s, p) => s + p.spend, 0);
    const totalImpressions = performance.reduce((s, p) => s + p.impressions, 0);
    const totalClicks = performance.reduce((s, p) => s + p.clicks, 0);
    const avgCTR =
      totalImpressions > 0
        ? ((totalClicks / totalImpressions) * 100).toFixed(2)
        : "0.00";

    const { data: scans } = await supabase
      .from("compliance_scans")
      .select("*")
      .eq("user_id", user_id)
      .gte("scanned_at", sevenDaysAgo.toISOString())
      .order("scanned_at", { ascending: false });

    const typedScans = (scans as ComplianceScan[]) ?? [];
    const redScans = typedScans.filter((s) => s.result === "red").length;
    const yellowScans = typedScans.filter((s) => s.result === "yellow").length;
    const greenScans = typedScans.filter((s) => s.result === "green").length;

    const reportDate = new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    const reportJson = {
      user_id,
      report_date: new Date().toISOString().split("T")[0],
      performance: { totalSpend, totalImpressions, totalClicks, avgCTR },
      compliance: {
        total: typedScans.length,
        green: greenScans,
        yellow: yellowScans,
        red: redScans,
      },
    };

    await supabase.from("weekly_reports").insert({
      user_id,
      report_date: reportJson.report_date,
      report_json: reportJson,
    });

    const complianceStatus =
      redScans > 0
        ? `${redScans} violation(s) found`
        : yellowScans > 0
        ? `${yellowScans} item(s) need review`
        : "All clear - fully compliant";

    const complianceColor =
      redScans > 0 ? "#ef4444" : yellowScans > 0 ? "#f59e0b" : "#22c55e";

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="background:#0d1b2a;color:#fff;font-family:Arial,sans-serif;padding:40px 20px;max-width:600px;margin:0 auto;">
  <h1 style="color:#fff;font-size:24px;margin-bottom:4px;">EyeOnAds Weekly Report</h1>
  <p style="color:#94a3b8;margin-top:0;">${reportDate}</p>
  <p style="color:#cbd5e1;">Hi ${typedProfile.full_name ?? typedProfile.email},</p>
  <p style="color:#cbd5e1;">Here is your weekly summary for your EyeOnAds account.</p>

  <h2 style="color:#60a5fa;font-size:18px;border-bottom:1px solid #1e3a5f;padding-bottom:8px;">Ad Performance (Last 7 Days)</h2>
  <table style="width:100%;border-collapse:collapse;">
    <tr>
      <td style="padding:8px 0;color:#94a3b8;">Total Spend</td>
      <td style="padding:8px 0;color:#fff;text-align:right;font-weight:bold;">$${totalSpend.toFixed(2)}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;color:#94a3b8;">Impressions</td>
      <td style="padding:8px 0;color:#fff;text-align:right;font-weight:bold;">${totalImpressions.toLocaleString()}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;color:#94a3b8;">Clicks</td>
      <td style="padding:8px 0;color:#fff;text-align:right;font-weight:bold;">${totalClicks.toLocaleString()}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;color:#94a3b8;">CTR</td>
      <td style="padding:8px 0;color:#fff;text-align:right;font-weight:bold;">${avgCTR}%</td>
    </tr>
  </table>

  <h2 style="color:#60a5fa;font-size:18px;border-bottom:1px solid #1e3a5f;padding-bottom:8px;margin-top:32px;">Compliance Status</h2>
  <p style="color:${complianceColor};font-weight:bold;font-size:18px;">${complianceStatus}</p>
  <table style="width:100%;border-collapse:collapse;">
    <tr>
      <td style="padding:8px 0;color:#94a3b8;">Total scans this week</td>
      <td style="padding:8px 0;color:#fff;text-align:right;">${typedScans.length}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;color:#22c55e;">Green (compliant)</td>
      <td style="padding:8px 0;color:#22c55e;text-align:right;">${greenScans}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;color:#f59e0b;">Yellow (review needed)</td>
      <td style="padding:8px 0;color:#f59e0b;text-align:right;">${yellowScans}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;color:#ef4444;">Red (violation found)</td>
      <td style="padding:8px 0;color:#ef4444;text-align:right;">${redScans}</td>
    </tr>
  </table>

  <div style="margin-top:32px;padding:16px;background:#1e3a5f;border-radius:8px;">
    <p style="color:#94a3b8;font-size:12px;margin:0;">
      EyeOnAds is not a law firm. Compliance results are not legal advice.
      Always consult a qualified real estate attorney for legal guidance.
    </p>
  </div>
</body>
</html>`;

    await sgMail.send({
      to: typedProfile.email,
      from: "reports@eyeonads.com",
      subject: `EyeOnAds Weekly Report - ${reportDate}`,
      html,
    });

    await supabase
      .from("weekly_reports")
      .update({ sent_at: new Date().toISOString() })
      .eq("user_id", user_id)
      .eq("report_date", reportJson.report_date);

    return NextResponse.json({ success: true, report: reportJson });
  } catch (err) {
    console.error("[/api/weekly-report] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
