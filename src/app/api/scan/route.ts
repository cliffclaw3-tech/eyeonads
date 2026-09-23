export const maxDuration = 60;
import { validScanInput } from "@/lib/scan-contract";
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { reviewAdImage, type ImageReview } from "@/lib/image-review";
import { createClient } from "@/lib/supabase/server";
import type { ComplianceFlag, ScanImageAttachment } from "@/lib/supabase/types";

import { reviewAdText } from "@/lib/ad-review";


type OpenAIResponse = {
  result: "green" | "yellow" | "red";
  flags: ComplianceFlag[];
  summary: string;
};

type AnalysisSource = "openai" | "rule_fallback" | "canary_sink";

function createRuleBasedScanResult(ad_copy: string, source: Exclude<AnalysisSource, "openai">): OpenAIResponse {
  const flags: ComplianceFlag[] = [];
  const lower = ad_copy.toLowerCase();

  if (!lower.includes("equal housing opportunity") && !lower.includes("eho")) {
    flags.push({
      rule: "Housing disclosure needs review",
      severity: "yellow",
      explanation: "The ad copy does not include Equal Housing Opportunity or EHO language.",
      recommendation: "Verify whether Equal Housing Opportunity text or a logo is appropriate for this ad.",
    });
  }

  if (!lower.includes("license") && !lower.includes("lic.")) {
    flags.push({
      rule: "License disclosure needs review",
      severity: "yellow",
      explanation: "The ad copy does not show a real estate license number.",
      recommendation: "Verify which brokerage and license disclosures apply to this ad before publishing.",
    });
  }

  if (lower.includes("top schools") || lower.includes("exclusive buyer list")) {
    flags.push({
      rule: "Potential Fair Housing or Misleading Claim",
      severity: "yellow",
      explanation: "The ad includes language that can imply protected-class targeting or an exclusive market claim.",
      recommendation: "Use neutral property descriptions and avoid claims that imply restricted access or demographic targeting.",
    });
  }

  return {
    result: flags.some((flag) => flag.severity === "red") ? "red" : "yellow",
    flags,
    summary:
      flags.length > 0
        ? `${source === "canary_sink" ? "Canary sink" : "Rule-based fallback"} scan found potential issues requiring review.`
        : `${source === "canary_sink" ? "Canary sink" : "Rule-based fallback"} review is incomplete; no obvious issues were found by these limited rules. Professional review is still required.`,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json().catch(() => null);
    if (!validScanInput(body)) return NextResponse.json({ error: "Provide 1–10,000 characters of ad copy, a supported state, and an optional PNG/JPEG under 2 MB encoded." }, { status: 400 });
    const { ad_copy, state, user_id, image_base64, image_filename } = body;

    if (!ad_copy || !state) {
      return NextResponse.json(
        { error: "Missing required fields: ad_copy, state" },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    if (user_id && user_id !== user.id) {
      return NextResponse.json({ error: "Authenticated user mismatch" }, { status: 403 });
    }

    const canarySink = process.env.EYEONADS_CANARY_SINK === "1";

    let parsed: OpenAIResponse;
    let analysisSource: AnalysisSource = "openai";
    if (canarySink) {
      analysisSource = "canary_sink";
      parsed = createRuleBasedScanResult(ad_copy, analysisSource);
    } else if (process.env.EYEONADS_PAID_ANALYSIS_ENABLED !== "1" || !process.env.OPENAI_API_KEY) {
      analysisSource = "rule_fallback";
      parsed = createRuleBasedScanResult(ad_copy, analysisSource);
    } else {
      try {
        parsed = await reviewAdText(ad_copy, state, image_base64 ? 'This input is accompanying user-supplied text. An attached image is assessed separately. Do not claim that statements in this copy were visible in the image, or that missing text is absent from the full image or linked disclosures.' : undefined);
      } catch {
        analysisSource = "rule_fallback";
        console.error("[/api/scan] AI unavailable; limited rule review used.");
        parsed = createRuleBasedScanResult(ad_copy, analysisSource);
      }
    }

    let { result, flags } = parsed;
    let { summary } = parsed;
    let imageAnalysisStatus = "not_requested";
    flags = flags ?? [];

    if (!result || !["green", "yellow", "red"].includes(result)) {
      return NextResponse.json(
        { error: "AI returned invalid result value" },
        { status: 500 }
      );
    }

    let attachment: ScanImageAttachment | null = null;
    if (image_base64) {
      const imageReview: ImageReview = !canarySink && process.env.EYEONADS_PAID_ANALYSIS_ENABLED === "1"
        ? await reviewAdImage(image_base64, "User-uploaded real estate ad creative. The image may be a property photo or only part of the full advertisement.")
        : {status: "unavailable", observations: null, notes: "Image review unavailable; no missing disclosure was established."};
      imageAnalysisStatus = imageReview.status;
      summary += ` Image review: ${imageReview.notes}${imageReview.observations ? ` ${imageReview.observations.notes}` : ""}`;
      if (imageReview.status === "unavailable" || imageReview.status === "partial") {
        flags.push({rule: imageReview.status === "unavailable" ? "Image review unavailable" : "Image coverage is partial", severity: "yellow",
          explanation: imageReview.notes,
          recommendation: "Review the complete advertisement and any permitted linked disclosures before publishing."});
        if (result === "green") result = "yellow";
      }
      attachment = {filename: image_filename || "Uploaded ad image", data_url: image_base64,
        sha256: createHash("sha256").update(Buffer.from(image_base64.split(",")[1], "base64")).digest("hex"),
        captured_at: new Date().toISOString(), review_status: imageReview.status, observations: imageReview.observations};
    }

    let persisted = false;
    let scanId: string | null = null;
    if (!canarySink) {
      const { data: saved, error: insertError } = await supabase.from("compliance_scans").insert({
        user_id: user.id,
        ad_copy,
        state,
        result,
        flags: flags ?? [],
        ai_explanation: summary ?? null,
        analysis_source: analysisSource,
        image_attachment: attachment,
      }).select("id").single();

      if (insertError || !saved?.id) {
        return NextResponse.json({ error: "Scan could not be saved. Please retry; no saved result is confirmed." }, { status: 503 });
      } else {
        persisted = true;
        scanId = saved.id;
      }
    }

    return NextResponse.json({
      result: {
        result,
        flags: flags ?? [],
        summary: summary ?? "",
        canary_sink: canarySink,
        analysis_source: analysisSource,
        image_analysis_status: imageAnalysisStatus,
        image_attachment: attachment,
        persisted,
        scan_id: scanId,
      },
    });
  } catch {
    console.error("[/api/scan] Request failed");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
