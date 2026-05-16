import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
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
};

type OpenAIResponse = {
  result: "green" | "yellow" | "red";
  flags: ComplianceFlag[];
  summary: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ScanRequestBody;
    const { ad_copy, state, user_id } = body;

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

    let parsed: OpenAIResponse;
    try {
      parsed = JSON.parse(raw) as OpenAIResponse;
    } catch {
      return NextResponse.json(
        { error: "AI returned invalid JSON", raw },
        { status: 500 }
      );
    }

    const { result, flags, summary } = parsed;

    if (!result || !["green", "yellow", "red"].includes(result)) {
      return NextResponse.json(
        { error: "AI returned invalid result value" },
        { status: 500 }
      );
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
