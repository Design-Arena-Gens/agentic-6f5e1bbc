type DraftPayload = {
  openAiKey?: string;
  openAiModel?: string;
  instructions?: string;
  automation?: {
    goal?: string;
    subjectTemplate?: string;
    bodyTemplate?: string;
    plainTextTemplate?: string;
  };
  recipient?: {
    name?: string;
    email?: string;
    company?: string;
    role?: string;
    customFields?: Record<string, string>;
  };
};

export async function POST(request: Request) {
  const body = (await request.json()) as DraftPayload;

  if (!body.openAiKey) {
    return Response.json({ error: 'Missing OpenAI API key' }, { status: 400 });
  }

  if (!body.recipient?.email || !body.recipient?.name) {
    return Response.json({ error: 'Recipient must include name and email' }, { status: 400 });
  }

  const model = body.openAiModel ?? 'gpt-4o-mini';
  const instructions = body.instructions ?? 'Write a clear outreach email and finish with a direct CTA.';

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${body.openAiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'draft_email',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              subject: { type: 'string' },
              html: { type: 'string' },
              text: { type: 'string' },
            },
            required: ['subject', 'html', 'text'],
          },
        },
      },
      messages: [
        {
          role: 'system',
          content:
            'You are an SDR automation agent. Produce concise, personalized outreach emails grounded in the provided context.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                `Goal: ${body.automation?.goal ?? 'Drive response'}`,
                `Template subject: ${body.automation?.subjectTemplate ?? ''}`,
                `Template HTML: ${body.automation?.bodyTemplate ?? ''}`,
                `Template text: ${body.automation?.plainTextTemplate ?? ''}`,
                `Recipient: ${JSON.stringify(body.recipient, null, 2)}`,
                `Instructions: ${instructions}`,
                'Respond with JSON containing subject, html, and text fields.',
              ].join('\n\n'),
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    return Response.json(
      {
        error: 'Failed to draft email',
        detail: errorBody,
      },
      { status: response.status },
    );
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    return Response.json({ error: 'LLM did not return content' }, { status: 422 });
  }

  try {
    const parsed = JSON.parse(content) as {
      subject: string;
      html: string;
      text: string;
    };
    return Response.json(parsed);
  } catch (error) {
    return Response.json(
      {
        error: 'Could not parse model output',
        detail: error instanceof Error ? error.message : 'Unknown error',
        raw: content,
      },
      { status: 422 },
    );
  }
}

