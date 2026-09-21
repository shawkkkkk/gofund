import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeGoFundMeUrl } from "@/lib/gofundme";
import { enforceRequestSize, rateLimit } from "@/lib/rate-limit";

const schema = z.object({ url: z.string().min(1) });

export async function POST(request: Request) {
  const gate = rateLimit(request, "campaign-preview", 30, 60_000);
  if (!gate.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "retry-after": String(gate.retryAfterSeconds) } },
    );
  }

  try {
    enforceRequestSize(request, 4_096);
    const { url } = schema.parse(await request.json());
    return NextResponse.json(normalizeGoFundMeUrl(url));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid campaign URL" },
      { status: 400 },
    );
  }
}
