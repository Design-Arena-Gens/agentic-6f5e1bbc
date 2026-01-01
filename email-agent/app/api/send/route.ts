const RESEND_ENDPOINT = 'https://api.resend.com/emails';

type SendRequestPayload = {
  resendApiKey?: string;
  from?: string;
  replyTo?: string;
  enableTracking?: boolean;
  batchSize?: number;
  cooldownMinutes?: number;
  payloads?: {
    id: string;
    email: string;
    name: string;
    subject: string;
    html: string;
    text: string;
  }[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withBounds = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export async function POST(request: Request) {
  const body = (await request.json()) as SendRequestPayload;

  if (!body.resendApiKey) {
    return Response.json({ error: 'Missing Resend API key' }, { status: 400 });
  }

  if (!body.from) {
    return Response.json({ error: 'Missing "from" address' }, { status: 400 });
  }

  if (!body.payloads || body.payloads.length === 0) {
    return Response.json({ error: 'No recipients to send' }, { status: 400 });
  }

  const results: { id: string; ok: boolean; error?: string }[] = [];
  const batchSize = body.batchSize ?? 20;
  const cooldownMs = withBounds((body.cooldownMinutes ?? 5) * 1000, 0, 15000);

  for (let index = 0; index < body.payloads.length; index += 1) {
    const payload = body.payloads[index];

    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${body.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: body.from,
          to: [{ email: payload.email, name: payload.name }],
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
          reply_to: body.replyTo,
          tags: body.enableTracking ? [{ name: 'tracking', value: 'enabled' }] : undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        results.push({
          id: payload.id,
          ok: false,
          error:
            data?.message ??
            data?.error ??
            `Resend API error (${response.status})`,
        });
      } else {
        results.push({ id: payload.id, ok: true });
      }
    } catch (error) {
      results.push({
        id: payload.id,
        ok: false,
        error: error instanceof Error ? error.message : 'Unexpected error',
      });
    }

    const isLastInBatch = (index + 1) % batchSize === 0 && index + 1 < body.payloads.length;
    if (isLastInBatch && cooldownMs > 0) {
      await sleep(cooldownMs);
    }
  }

  return Response.json({ results });
}

