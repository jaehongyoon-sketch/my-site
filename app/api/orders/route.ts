export async function POST() {
  return Response.json(
    {
      code: "LIVE_TRADING_UNAVAILABLE",
      message:
        "Event order acceptance is not connected. No order was placed.",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
