import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import type { ComplianceFlag } from "@/lib/supabase/types";

const COMPLIANCE_SYSTEM_PROMPT = `You are a real estate advertising compliance expert specializing in Tennessee Real Estate Commission rules and Fair Housing law. Analyze the provided ad copy and return a JSON response with:
- result: "green" | "yellow" | "red"
- flags: array of {rule, severity, explanation, recommendation}
- summary: one sentence plain English summary

Tennessee RE Commission advertising rules to check:
1. Brokerage name must be prominently displayed (not smaller than agent name)
2. Agent's licensed name must appear as it appears on their license
3. Fair Housing: "Equal Housing Opportunity" or EHO logo required on housing ads
4. No misleading claims about property values or market conditions
5. Team names must include the brokerage name
6. Meta/Facebook housing ads must use Special Ad Category: Housing (no demographic targeting)
7. No discriminatory language or targeting based on protected classes

Return ONLY valid JSON, no markdown.`;

type ScanRequestBody = {
  ad_copy: string;
  state: string;
  user_id: string;
  image_base64?: string;
};

type OpenAIResponse = {
  result: "green" | "yellow" | "red";
  flags: ComplianceFlag[];
  summary: string;
};

type ImageAnalysis = {
  eho_present: boolean;
  license_visible: boolean;
  brokerage_visible: boolean;
  sold_misuse: boolean;
  notes: string;
};

async function analyzeImageWithAnthropic(image_base64: string): Promise<ImageAnalysis | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const client = new Anthropic({ apiKey });
    // Strip data URL prefix if present
    const base64Data = image_base64.replace(/^data:image\/[a-z]+;base64,/, "");
    // Detect media type
    const mediaTypeMatch = image_base64.match(/^data:(image\/[a-z]+);base64,/);
    const mediaType = (mediaTypeMatch?.[1] as "image/jpeg" | "image/png" | "image/gif" | "image/webp") ?? "image/jpeg";

    const response = await client.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64Data,
              },
            },
            {
              type: "text",
              text: 'You are a real estate advertising compliance checker. Analyze this ad image for: 1) Equal Housing Opportunity logo or text present (yes/no) 2) License number visible (yes/no) 3) Brokerage name visible (yes/no) 4) Any \'SOLD\' imagery used inappropriately. Return JSON: {"eho_present": bool, "license_visible": bool, "brokerage_visible": bool, "sold_misuse": bool, "notes": string}',
            },
          ],
        },
      ],
    });

    const raw = response.content[0]?.type === "text" ? response.content[0].text : "{}";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    return JSON.parse(cleaned) as ImageAnalysis;
  } catch (err) {
    console.error("[image analysis] Anthropic error:", err);
    return null;
  }
}

function ruleBasedImageFallback(): ImageAnalysis {
  // Without actual vision, we conservatively flag all items as potentially missing
  return {
    eho_present: false,
    license_visible: false,
    brokerage_visible: false,
    sold_misuse: false,
    notes: "Image analysis unavailable — please verify manually",
  };
}

function imageAnalysisToFlags(analysis: ImageAnalysis): ComplianceFlag[] {
  const flags: ComplianceFlag[] = [];

  if (!analysis.eho_present) {
    flags.push({
      rule: "Equal Housing Opportunity Logo Missing",
      severity: "red",
      explanation: "No Equal Housing Opportunity logo or text detected in the ad image.",
      recommendation: "Add the EHO logo or the text 'Equal Housing Opportunity' to your ad creative.",
    });
  }

  if (!analysis.license_visible) {
    flags.push({
      rule: "License Number Not Visible in Image",
      severity: "red",
      explanation: "No license number visible in the ad image.",
      recommendation: "Include your real estate license number prominently in the ad creative.",
    });
  }

  if (!analysis.brokerage_visible) {
    flags.push({
      rule: "Brokerage Name Not Visible in Image",
      severity: "yellow",
      explanation: "Brokerage name could not be confirmed in the ad image.",
      recommendation: "Ensure the brokerage name is clearly visible and not smaller than your agent name.",
    });
  }

  if (analysis.sold_misuse) {
    flags.push({
      rule: "Inappropriate 'SOLD' Imagery",
      severity: "yellow",
      explanation: "Image appears to contain 'SOLD' imagery that may be used misleadingly.",
      recommendation: "Only use 'SOLD' imagery for properties you personally sold, and ensure it complies with state rules.",
    });
  }

  return flags;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ScanRequestBody;
    const { ad_copy, state, user_id, image_base64 } = body;

    if (!ad_copy || !state || !user_id) {
      return NextResponse.json(
        { error: "Missing required fields: ad_copy, state, user_id" },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 500 }
      );
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: COMPLIANCE_SYSTEM_PROMPT },
        {
          role: "user",
          content: `State: ${state}\n\nAd Copy:\n${ad_copy}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 1500,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    let parsed: OpenAIResponse;
    try {
      parsed = JSON.parse(cleaned) as OpenAIResponse;
    } catch {
      return NextResponse.json(
        { error: "AI returned invalid JSON", raw },
        { status: 500 }
      );
    }

    let { result, flags } = parsed;
    const { summary } = parsed;
    flags = flags ?? [];

    if (!result || !["green", "yellow", "red"].includes(result)) {
      return NextResponse.json(
        { error: "AI returned invalid result value" },
        { status: 500 }
      );
    }

    // Image analysis
    if (image_base64) {
      let imageAnalysis = await analyzeImageWithAnthropic(image_base64);
      if (!imageAnalysis) {
        imageAnalysis = ruleBasedImageFallback();
      }
      const imageFlags = imageAnalysisToFlags(imageAnalysis);
      flags = [...flags, ...imageFlags];

      // Upgrade result severity if image flags are red/yellow
      const hasImageRed = imageFlags.some((f) => f.severity === "red");
      const hasImageYellow = imageFlags.some((f) => f.severity === "yellow");
      if (hasImageRed && result === "green") result = "red";
      else if (hasImageRed && result === "yellow") result = "red";
      else if (hasImageYellow && result === "green") result = "yellow";
    }

    // Persist the scan in Supabase
    const supabase = await createClient();
    await supabase.from("compliance_scans").insert({
      user_id,
      ad_copy,
      state,
      result,
      flags: flags ?? [],
      ai_explanation: summary ?? null,
    });

    return NextResponse.json({
      result: { result, flags: flags ?? [], summary: summary ?? "" },
    });
  } catch (err) {
    console.error("[/api/scan] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
