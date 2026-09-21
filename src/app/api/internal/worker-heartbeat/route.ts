import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";

const schema = z.object({
  status: z.enum(["success", "error"]),
  error: z.string().max(1000).nullable().optional(),
});

function authorized(request: Request) {
  const expected = process.env.INTERNAL_API_SECRET;
  const supplied = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  return Boolean(expected && supplied === expected);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = schema.parse(await request.json());
    if (input.status === "success") {
      await query(
        `insert into worker_state(
           worker_name,last_attempt_at,last_success_at,last_error,updated_at
         ) values('main',now(),now(),null,now())
         on conflict(worker_name) do update set
           last_attempt_at=now(),
           last_success_at=now(),
           last_error=null,
           updated_at=now()`,
      );
    } else {
      await query(
        `insert into worker_state(
           worker_name,last_attempt_at,last_error_at,last_error,updated_at
         ) values('main',now(),now(),$1,now())
         on conflict(worker_name) do update set
           last_attempt_at=now(),
           last_error_at=now(),
           last_error=$1,
           updated_at=now()`,
        [input.error || "unknown worker error"],
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Heartbeat failed" },
      { status: 400 },
    );
  }
}
