'use client';

import type { ComponentType, SVGProps } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { nanoid } from 'nanoid';
import Papa from 'papaparse';
import {
  ArrowPathIcon,
  ClockIcon,
  DocumentDuplicateIcon,
  InformationCircleIcon,
  PaperAirplaneIcon,
  PlusIcon,
  QueueListIcon,
  SparklesIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { usePersistentState } from '@/lib/usePersistentState';
import { buildRecipientContext, renderTemplate } from '@/lib/templates';
import type { Automation, Recipient } from '@/types/automation';

type AutomationMetric = {
  label: string;
  value: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

const DEFAULT_INSTRUCTIONS =
  'Generate a polite email introducing our offering. Keep it under 170 words and end with a clear call to action.';

const createAutomation = (): Automation => ({
  id: nanoid(),
  name: 'New automation',
  goal: 'Introduce our product and book a demo',
  senderName: 'Growth Team',
  senderEmail: 'team@example.com',
  replyTo: '',
  subjectTemplate: 'Hi {{name}}, quick idea for {{company}}',
  bodyTemplate: `<p>Hey {{name}},</p>
<p>My name is {{senderName}} and I help teams like {{company}} automate their outreach. Based on what {{company}} is building, I pulled together a playbook you can copy this week.</p>
<p>Would it be a bad idea to walk you through it on a quick call?</p>
<p>Best,<br/>{{senderName}}</p>`,
  plainTextTemplate:
    'Hey {{name}},\n\nMy name is {{senderName}} and I help teams like {{company}} automate their outreach. Based on what {{company}} is building, I pulled together a playbook you can copy this week.\n\nWould it be a bad idea to walk you through it on a quick call?\n\nBest,\n{{senderName}}',
  aiDrafting: false,
  openAiModel: 'gpt-4o-mini',
  recipients: [],
  cooldownMinutes: 5,
  batchSize: 20,
  enableTracking: true,
  status: 'idle',
  logs: [],
});

const metricsForAutomation = (automation: Automation): AutomationMetric[] => [
  {
    label: 'Recipients',
    value: automation.recipients.length.toString(),
    icon: QueueListIcon,
  },
  {
    label: 'Ready to send',
    value: automation.recipients
      .filter((recipient) => recipient.status === 'drafted')
      .length.toString(),
    icon: PaperAirplaneIcon,
  },
  {
    label: 'Cooldown',
    value: `${automation.cooldownMinutes}m`,
    icon: ClockIcon,
  },
];

const instructionsHint = [
  'Reference public signals (fundraise, hiring, content)',
  'Suggest a time or ask a binary question',
  'Sound like a human, not marketing copy',
].join(' · ');

const calculateTemplatePreview = (
  automation: Automation,
  recipient: Recipient,
) => {
  const baseContext = {
    name: recipient.name,
    email: recipient.email,
    company: recipient.company ?? '',
    role: recipient.role ?? '',
    ...recipient.customFields,
  };

  const context = buildRecipientContext(baseContext, {
    senderName: automation.senderName,
    senderEmail: automation.senderEmail,
    company: recipient.company ?? '',
  });

  const subject = recipient.previewSubject
    ? recipient.previewSubject
    : renderTemplate(automation.subjectTemplate, context);

  const html = recipient.previewHtml
    ? recipient.previewHtml
    : renderTemplate(automation.bodyTemplate, context);

  const text = recipient.previewText
    ? recipient.previewText
    : renderTemplate(automation.plainTextTemplate ?? '', context);

  return { subject, html, text };
};

const formatDate = (date?: string) =>
  date
    ? new Date(date).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
      })
    : '—';

type DraftQueueItem = {
  id: string;
  name: string;
  status: Recipient['status'];
};

async function draftWithOpenAI(args: {
  recipient: Recipient;
  automation: Automation;
  instructions: string;
  openAiKey: string;
}) {
  const response = await fetch('/api/draft', {
    method: 'POST',
    body: JSON.stringify({
      openAiKey: args.openAiKey,
      openAiModel: args.automation.openAiModel,
      automation: {
        goal: args.automation.goal,
        subjectTemplate: args.automation.subjectTemplate,
        bodyTemplate: args.automation.bodyTemplate,
        plainTextTemplate: args.automation.plainTextTemplate,
      },
      instructions: args.instructions,
      recipient: args.recipient,
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as {
    subject: string;
    html: string;
    text: string;
  };
}

export default function HomePage() {
  const [automations, setAutomations] = usePersistentState<Automation[]>(
    'email-automations',
    [createAutomation()],
  );
  const [selectedAutomationId, setSelectedAutomationId] = useState(
    automations[0]?.id ?? '',
  );
  const [draftInstructions, setDraftInstructions] = useState(
    DEFAULT_INSTRUCTIONS,
  );
  const [openAiKey, setOpenAiKey] = useState('');
  const [resendKey, setResendKey] = useState('');
  const [selectedRecipientId, setSelectedRecipientId] = useState<string | null>(
    null,
  );
  const [isUploadingCSV, setIsUploadingCSV] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const selectedAutomation = useMemo(
    () => automations.find((automation) => automation.id === selectedAutomationId),
    [automations, selectedAutomationId],
  );

  useEffect(() => {
    if (!selectedAutomation && automations[0]) {
      setSelectedAutomationId(automations[0].id);
    }
  }, [automations, selectedAutomation]);

  useEffect(() => {
    if (!selectedAutomation) return;
    if (selectedAutomation.recipients.length === 0) {
      setSelectedRecipientId(null);
      return;
    }

    const currentRecipient = selectedAutomation.recipients.find(
      (recipient) => recipient.id === selectedRecipientId,
    );

    if (!currentRecipient) {
      setSelectedRecipientId(selectedAutomation.recipients[0]?.id ?? null);
    }
  }, [selectedAutomation, selectedRecipientId]);

  const mutateAutomation = (mutation: (automation: Automation) => Automation) => {
    setAutomations((current) =>
      current.map((automation) =>
        automation.id === selectedAutomationId
          ? mutation(structuredClone(automation))
          : automation,
      ),
    );
  };

  const addLog = (
    automationId: string,
    entry: Automation['logs'][number],
  ) => {
    setAutomations((current) =>
      current.map((automation) =>
        automation.id === automationId
          ? {
              ...automation,
              logs: [entry, ...automation.logs].slice(0, 40),
            }
          : automation,
      ),
    );
  };

  const handleUpdateField =
    <K extends keyof Automation>(key: K) =>
    (value: Automation[K]) => {
      mutateAutomation((automation) => {
        automation[key] = value;
        return automation;
      });
    };

  const handleAddAutomation = () => {
    const automation = createAutomation();
    setAutomations((current) => [automation, ...current]);
    setSelectedAutomationId(automation.id);
  };

  const handleDuplicateAutomation = () => {
    if (!selectedAutomation) return;
    const copy: Automation = {
      ...structuredClone(selectedAutomation),
      id: nanoid(),
      name: `${selectedAutomation.name} (copy)`,
      status: 'idle',
      logs: [],
      recipients: selectedAutomation.recipients.map((recipient) => ({
        ...structuredClone(recipient),
        id: nanoid(),
        status: 'pending',
        lastError: undefined,
      })),
    };
    setAutomations((current) => [copy, ...current]);
    setSelectedAutomationId(copy.id);
  };

  const handleDeleteAutomation = () => {
    if (!selectedAutomation) return;
    setAutomations((current) =>
      current.filter((automation) => automation.id !== selectedAutomation.id),
    );
    setSelectedAutomationId((current) => {
      if (current === selectedAutomation.id) {
        return automations.find((automation) => automation.id !== current)?.id ?? '';
      }
      return current;
    });
  };

  const handleCreateRecipient = (recipient: Omit<Recipient, 'id' | 'status'>) => {
    mutateAutomation((automation) => {
      automation.recipients.unshift({
        ...recipient,
        id: nanoid(),
        status: 'pending',
      });
      return automation;
    });
  };

  const handleUpdateRecipient = (recipientId: string, patch: Partial<Recipient>) => {
    mutateAutomation((automation) => {
      automation.recipients = automation.recipients.map((recipient) =>
        recipient.id === recipientId ? { ...recipient, ...patch } : recipient,
      );
      return automation;
    });
  };

  const handleDeleteRecipient = (recipientId: string) => {
    mutateAutomation((automation) => {
      automation.recipients = automation.recipients.filter(
        (recipient) => recipient.id !== recipientId,
      );
      return automation;
    });
  };

  const handleCsvUpload: React.ChangeEventHandler<HTMLInputElement> = async (
    event,
  ) => {
    const file = event.target.files?.[0];
    if (!file || !selectedAutomation) return;

    setIsUploadingCSV(true);
    setUploadError(null);

    try {
      const result = await new Promise<Papa.ParseResult<Record<string, string>>>(
        (resolve, reject) => {
          Papa.parse<Record<string, string>>(file, {
            header: true,
            skipEmptyLines: true,
            complete: resolve,
            error: reject,
          });
        },
      );

      if (result.errors.length > 0) {
        throw new Error(result.errors[0]?.message ?? 'CSV parsing failed');
      }

      const recipients: Recipient[] = result.data
        .map((row) => ({
          id: nanoid(),
          name: row.name ?? row.full_name ?? '',
          email: row.email ?? row.address ?? '',
          company: row.company ?? row.organization ?? '',
          role: row.role ?? row.title ?? '',
          customFields: Object.fromEntries(
            Object.entries(row).filter(
              ([key]) =>
                !['name', 'full_name', 'email', 'address', 'company', 'organization', 'role', 'title'].includes(
                  key,
                ),
            ),
          ),
          status: 'pending' as const,
        }))
        .filter((recipient) => recipient.name && recipient.email);

      mutateAutomation((automation) => {
        automation.recipients = [...recipients, ...automation.recipients];
        automation.logs.unshift({
          id: nanoid(),
          timestamp: new Date().toISOString(),
          level: 'info',
          message: `Imported ${recipients.length} recipients from CSV`,
        });
        return automation;
      });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Failed to import CSV');
    } finally {
      setIsUploadingCSV(false);
      event.target.value = '';
    }
  };

  const draftQueue: DraftQueueItem[] = useMemo(() => {
    if (!selectedAutomation) return [];
    return selectedAutomation.recipients.map((recipient) => ({
      id: recipient.id,
      name: recipient.name,
      status: recipient.status,
    }));
  }, [selectedAutomation]);

  const handleDraftEmails = async () => {
    if (!selectedAutomation) return;
    if (!openAiKey) {
      setSendError('Add an OpenAI API key before drafting');
      return;
    }

    setSendError(null);
    setIsDrafting(true);
    mutateAutomation((automation) => {
      automation.status = 'drafting';
      return automation;
    });

    for (const recipient of selectedAutomation.recipients) {
      try {
        const result = await draftWithOpenAI({
          recipient,
          automation: selectedAutomation,
          instructions: draftInstructions,
          openAiKey,
        });

        handleUpdateRecipient(recipient.id, {
          previewSubject: result.subject,
          previewHtml: result.html,
          previewText: result.text,
          status: 'drafted',
          lastError: undefined,
        });

        addLog(selectedAutomation.id, {
          id: nanoid(),
          timestamp: new Date().toISOString(),
          level: 'info',
          message: `Drafted email for ${recipient.email}`,
          recipientId: recipient.id,
        });
      } catch (error) {
        handleUpdateRecipient(recipient.id, {
          status: 'failed',
          lastError: error instanceof Error ? error.message : 'Draft failed',
        });
        addLog(selectedAutomation.id, {
          id: nanoid(),
          timestamp: new Date().toISOString(),
          level: 'error',
          message: `Draft failed for ${recipient.email}`,
          recipientId: recipient.id,
        });
      }
    }

    mutateAutomation((automation) => {
      automation.status = 'idle';
      automation.lastRunAt = new Date().toISOString();
      return automation;
    });
    setIsDrafting(false);
  };

  const handleSendEmails = async () => {
    if (!selectedAutomation) return;
    if (!resendKey) {
      setSendError('Add a Resend API key before sending');
      return;
    }

    const payloadRecipients = selectedAutomation.recipients.filter(
      (recipient) => recipient.status === 'drafted' || recipient.status === 'pending',
    );

    if (payloadRecipients.length === 0) {
      setSendError('No drafted recipients to send');
      return;
    }

    setSendError(null);
    setIsSending(true);
    mutateAutomation((automation) => {
      automation.status = 'sending';
      return automation;
    });

    try {
      const response = await fetch('/api/send', {
        method: 'POST',
        body: JSON.stringify({
          resendApiKey: resendKey,
          from: `${selectedAutomation.senderName} <${selectedAutomation.senderEmail}>`,
          replyTo: selectedAutomation.replyTo,
          enableTracking: selectedAutomation.enableTracking,
          batchSize: selectedAutomation.batchSize,
          cooldownMinutes: selectedAutomation.cooldownMinutes,
          payloads: payloadRecipients.map((recipient) => {
            const draft = calculateTemplatePreview(selectedAutomation, recipient);
            return {
              id: recipient.id,
              email: recipient.email,
              name: recipient.name,
              subject: draft.subject,
              html: draft.html,
              text: draft.text,
            };
          }),
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const result = (await response.json()) as {
        results: { id: string; ok: boolean; error?: string }[];
      };

      result.results.forEach((entry) => {
        if (entry.ok) {
          handleUpdateRecipient(entry.id, {
            status: 'sent',
            lastError: undefined,
          });
          addLog(selectedAutomation.id, {
            id: nanoid(),
            timestamp: new Date().toISOString(),
            level: 'info',
            message: `Email sent to ${payloadRecipients.find((r) => r.id === entry.id)?.email ?? 'recipient'}`,
            recipientId: entry.id,
          });
        } else {
          handleUpdateRecipient(entry.id, {
            status: 'failed',
            lastError: entry.error ?? 'Unknown error',
          });
          addLog(selectedAutomation.id, {
            id: nanoid(),
            timestamp: new Date().toISOString(),
            level: 'error',
            message: entry.error ?? 'Failed to send email',
            recipientId: entry.id,
          });
        }
      });
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Failed to send emails');
    } finally {
      setIsSending(false);
      mutateAutomation((automation) => {
        automation.status = 'idle';
        automation.lastRunAt = new Date().toISOString();
        return automation;
      });
    }
  };

  const selectedRecipient = selectedAutomation?.recipients.find(
    (recipient) => recipient.id === selectedRecipientId,
  );

  return (
    <div className="min-h-screen bg-slate-950 pb-20 font-sans text-slate-50">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 pt-12">
        <header className="flex flex-col gap-6 rounded-3xl bg-slate-900/70 p-6 ring-1 ring-white/10 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-sky-300/80">
              Agentic email ops
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight lg:text-4xl">
              Automation control center
            </h1>
            <p className="mt-2 max-w-xl text-sm text-slate-300">
              Orchestrate multi-step outbound campaigns, generate personalized
              drafts with AI, and ship sequences directly from the dashboard.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleAddAutomation}
              className="flex items-center gap-2 rounded-full bg-sky-500 py-2.5 pl-3 pr-4 text-sm font-semibold text-slate-950 transition hover:bg-sky-400"
            >
              <PlusIcon className="h-4 w-4" />
              New automation
            </button>
            <button
              type="button"
              onClick={handleDuplicateAutomation}
              className="flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/10"
            >
              <DocumentDuplicateIcon className="h-4 w-4" />
              Duplicate
            </button>
            <button
              type="button"
              onClick={handleDeleteAutomation}
              className="flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-rose-300 transition hover:bg-rose-500/10 hover:text-rose-200"
            >
              <TrashIcon className="h-4 w-4" />
              Delete
            </button>
          </div>
        </header>

        <section className="rounded-3xl bg-slate-900/60 p-6 ring-1 ring-white/10">
          <nav className="flex flex-wrap items-center gap-2">
            {automations.map((automation) => (
              <button
                key={automation.id}
                type="button"
                onClick={() => setSelectedAutomationId(automation.id)}
                className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-wide ${
                  automation.id === selectedAutomationId
                    ? 'bg-sky-500 text-slate-950'
                    : 'bg-white/10 text-slate-300 hover:bg-white/15'
                }`}
              >
                {automation.name}
              </button>
            ))}
          </nav>
        </section>

        {selectedAutomation ? (
          <>
            <section className="grid gap-4 rounded-3xl bg-slate-900/50 p-6 ring-1 ring-white/10 lg:grid-cols-3">
              {metricsForAutomation(selectedAutomation).map((metric) => (
                <div
                  key={metric.label}
                  className="flex items-center justify-between rounded-2xl bg-slate-900/80 px-5 py-4 ring-1 ring-white/10"
                >
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                      {metric.label}
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-white">
                      {metric.value}
                    </p>
                  </div>
                  <metric.icon className="h-6 w-6 text-slate-400" />
                </div>
              ))}
              <div className="flex flex-col justify-between rounded-2xl bg-gradient-to-r from-sky-500/20 to-purple-500/20 px-5 py-4 ring-1 ring-white/10">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-200">
                  Last run
                </p>
                <p className="mt-2 text-lg font-medium">
                  {formatDate(selectedAutomation.lastRunAt)}
                </p>
                <p className="mt-2 flex items-center gap-2 text-xs text-slate-300">
                  <InformationCircleIcon className="h-4 w-4 text-slate-200" />
                  Drafts are stored locally. Keys are never persisted.
                </p>
              </div>
            </section>

            <section className="grid gap-6 rounded-3xl bg-slate-900/60 p-6 ring-1 ring-white/10 lg:grid-cols-5">
              <div className="space-y-4 lg:col-span-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Automation name
                  </label>
                  <input
                    value={selectedAutomation.name}
                    onChange={(event) => handleUpdateField('name')(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Conversion goal
                  </label>
                  <textarea
                    value={selectedAutomation.goal}
                    onChange={(event) => handleUpdateField('goal')(event.target.value)}
                    rows={2}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40"
                  />
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                      Sender name
                    </label>
                    <input
                      value={selectedAutomation.senderName}
                      onChange={(event) =>
                        handleUpdateField('senderName')(event.target.value)
                      }
                      className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                      Sender email
                    </label>
                    <input
                      value={selectedAutomation.senderEmail}
                      onChange={(event) =>
                        handleUpdateField('senderEmail')(event.target.value)
                      }
                      className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                      Reply-to
                    </label>
                    <input
                      value={selectedAutomation.replyTo ?? ''}
                      onChange={(event) =>
                        handleUpdateField('replyTo')(event.target.value)
                      }
                      className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40"
                      placeholder="Optional"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                      Batch size
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={selectedAutomation.batchSize}
                      onChange={(event) =>
                        handleUpdateField('batchSize')(Number(event.target.value))
                      }
                      className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                      Cooldown (minutes)
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={selectedAutomation.cooldownMinutes}
                      onChange={(event) =>
                        handleUpdateField('cooldownMinutes')(Number(event.target.value))
                      }
                      className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Subject template
                  </label>
                  <input
                    value={selectedAutomation.subjectTemplate}
                    onChange={(event) =>
                      handleUpdateField('subjectTemplate')(event.target.value)
                    }
                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                    HTML template
                  </label>
                  <textarea
                    value={selectedAutomation.bodyTemplate}
                    onChange={(event) =>
                      handleUpdateField('bodyTemplate')(event.target.value)
                    }
                    rows={6}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                    Plain text fallback
                  </label>
                  <textarea
                    value={selectedAutomation.plainTextTemplate ?? ''}
                    onChange={(event) =>
                      handleUpdateField('plainTextTemplate')(event.target.value)
                    }
                    rows={4}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40"
                  />
                </div>
                <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={selectedAutomation.enableTracking}
                    onChange={(event) =>
                      handleUpdateField('enableTracking')(event.target.checked)
                    }
                    className="h-4 w-4 rounded border border-white/20 bg-slate-900 text-sky-400 focus:ring-sky-400"
                  />
                  Enable open tracking
                </label>
              </div>

              <div className="space-y-4 rounded-2xl bg-slate-950/30 p-4 ring-1 ring-white/10">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-300">
                    AI drafting
                  </h2>
                  <SparklesIcon className="h-5 w-5 text-sky-300" />
                </div>
                <label className="text-xs uppercase tracking-[0.25em] text-slate-500">
                  OpenAI key
                </label>
                <input
                  value={openAiKey}
                  onChange={(event) => setOpenAiKey(event.target.value)}
                  placeholder="sk-..."
                  className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40"
                />
                <label className="text-xs uppercase tracking-[0.25em] text-slate-500">
                  Instructions
                </label>
                <textarea
                  value={draftInstructions}
                  onChange={(event) => setDraftInstructions(event.target.value)}
                  rows={4}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40"
                />
                <p className="text-xs text-slate-400">{instructionsHint}</p>
                <button
                  type="button"
                  onClick={handleDraftEmails}
                  disabled={isDrafting || selectedAutomation.recipients.length === 0}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-sky-500 to-purple-500 py-2.5 text-sm font-semibold text-slate-950 transition hover:from-sky-400 hover:to-purple-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isDrafting ? (
                    <>
                      <ArrowPathIcon className="h-4 w-4 animate-spin" />
                      Drafting…
                    </>
                  ) : (
                    <>
                      <SparklesIcon className="h-4 w-4" />
                      Generate drafts
                    </>
                  )}
                </button>
                <div className="rounded-xl border border-white/10 bg-slate-900/60 p-3">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                    Queue
                  </p>
                  <ul className="mt-3 space-y-2 text-xs text-slate-300">
                    {draftQueue.slice(0, 6).map((item) => (
                      <li key={item.id} className="flex items-center justify-between">
                        <span className="truncate">{item.name}</span>
                        <span
                          className={`font-medium ${
                            item.status === 'sent'
                              ? 'text-emerald-300'
                              : item.status === 'drafted'
                              ? 'text-sky-300'
                              : item.status === 'failed'
                              ? 'text-rose-300'
                              : 'text-slate-400'
                          }`}
                        >
                          {item.status}
                        </span>
                      </li>
                    ))}
                    {draftQueue.length === 0 && (
                      <li className="text-slate-500">
                        Add recipients to populate the queue.
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            </section>

            <section className="grid gap-6 rounded-3xl bg-slate-900/60 p-6 ring-1 ring-white/10 lg:grid-cols-5">
              <div className="space-y-4 lg:col-span-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-300">
                    Recipients
                  </h2>
                  <label className="flex items-center gap-2 rounded-full border border-white/15 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:bg-white/10">
                    <input
                      type="file"
                      accept=".csv"
                      onChange={handleCsvUpload}
                      disabled={isUploadingCSV}
                      className="hidden"
                    />
                    {isUploadingCSV ? 'Importing…' : 'Import CSV'}
                  </label>
                </div>
                {uploadError ? (
                  <p className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                    {uploadError}
                  </p>
                ) : null}
                <div className="rounded-2xl border border-white/10">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-950/60 text-xs uppercase tracking-[0.2em] text-slate-400">
                      <tr>
                        <th className="px-4 py-3">Name</th>
                        <th className="px-4 py-3">Email</th>
                        <th className="px-4 py-3">Company</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {selectedAutomation.recipients.map((recipient) => (
                        <tr
                          key={recipient.id}
                          className={`cursor-pointer transition hover:bg-white/5 ${
                            recipient.id === selectedRecipientId ? 'bg-white/10' : ''
                          }`}
                          onClick={() => setSelectedRecipientId(recipient.id)}
                        >
                          <td className="px-4 py-3">{recipient.name}</td>
                          <td className="px-4 py-3 text-slate-300">{recipient.email}</td>
                          <td className="px-4 py-3 text-slate-300">
                            {recipient.company ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-xs font-medium uppercase tracking-[0.2em]">
                            <span
                              className={`rounded-full px-2 py-1 ${
                                recipient.status === 'sent'
                                  ? 'bg-emerald-500/10 text-emerald-300'
                                  : recipient.status === 'drafted'
                                  ? 'bg-sky-500/10 text-sky-300'
                                  : recipient.status === 'failed'
                                  ? 'bg-rose-500/10 text-rose-300'
                                  : 'bg-white/10 text-slate-200'
                              }`}
                            >
                              {recipient.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleDeleteRecipient(recipient.id);
                              }}
                              className="rounded-full border border-white/10 p-1 text-slate-400 transition hover:bg-rose-500/20 hover:text-rose-200"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {selectedAutomation.recipients.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-4 py-6 text-center text-sm text-slate-400"
                          >
                            No recipients yet. Import a CSV or add manually.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
                <RecipientQuickForm onCreate={handleCreateRecipient} />
              </div>

              <div className="space-y-4 rounded-2xl bg-slate-950/30 p-4 ring-1 ring-white/10">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-300">
                    Preview
                  </h2>
                  <InformationCircleIcon className="h-5 w-5 text-slate-400" />
                </div>
                {selectedRecipient ? (
                  <>
                    <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                        Subject
                      </p>
                      <p className="mt-2 text-sm text-white">
                        {
                          calculateTemplatePreview(
                            selectedAutomation,
                            selectedRecipient,
                          ).subject
                        }
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                        HTML
                      </p>
                      <div
                        className="rich-text mt-3 space-y-3 text-sm text-slate-200"
                        dangerouslySetInnerHTML={{
                          __html: calculateTemplatePreview(
                            selectedAutomation,
                            selectedRecipient,
                          ).html,
                        }}
                      />
                    </div>
                    <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                        Plain text
                      </p>
                      <pre className="mt-3 whitespace-pre-wrap text-xs text-slate-200">
                        {
                          calculateTemplatePreview(
                            selectedAutomation,
                            selectedRecipient,
                          ).text
                        }
                      </pre>
                    </div>
                    {selectedRecipient.lastError ? (
                      <p className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
                        {selectedRecipient.lastError}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="rounded-xl border border-dashed border-white/10 bg-slate-900/30 p-6 text-sm text-slate-400">
                    Select a recipient to preview the templated draft.
                  </p>
                )}
              </div>
            </section>

            <section className="grid gap-6 rounded-3xl bg-slate-900/60 p-6 ring-1 ring-white/10 lg:grid-cols-5">
              <div className="space-y-4 rounded-2xl bg-slate-950/30 p-4 ring-1 ring-white/10 lg:col-span-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-300">
                    Deployment
                  </h2>
                  <PaperAirplaneIcon className="h-5 w-5 text-sky-300" />
                </div>
                <label className="text-xs uppercase tracking-[0.25em] text-slate-500">
                  Resend key
                </label>
                <input
                  value={resendKey}
                  onChange={(event) => setResendKey(event.target.value)}
                  placeholder="re_..."
                  className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40"
                />
                {sendError ? (
                  <p className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                    {sendError}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={handleSendEmails}
                  disabled={
                    isSending ||
                    selectedAutomation.recipients.filter(
                      (recipient) =>
                        recipient.status === 'drafted' || recipient.status === 'pending',
                    ).length === 0
                  }
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-sky-500 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isSending ? (
                    <>
                      <ArrowPathIcon className="h-4 w-4 animate-spin" />
                      Dispatching…
                    </>
                  ) : (
                    <>
                      <PaperAirplaneIcon className="h-4 w-4" />
                      Send campaign
                    </>
                  )}
                </button>
                <p className="text-xs text-slate-400">
                  Emails are sent sequentially with a smart cooldown (
                  {selectedAutomation.cooldownMinutes}
                  m) between batches of {selectedAutomation.batchSize}.
                </p>
              </div>

              <div className="space-y-4 rounded-2xl bg-slate-950/30 p-4 ring-1 ring-white/10">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-300">
                    Activity
                  </h2>
                  <ArrowPathIcon className="h-5 w-5 text-slate-400" />
                </div>
                <ul className="space-y-3 text-xs text-slate-300">
                  {selectedAutomation.logs.slice(0, 20).map((log) => (
                    <li
                      key={log.id}
                      className="rounded-xl border border-white/10 bg-slate-900/60 p-3"
                    >
                      <p className="font-semibold text-slate-100">{log.message}</p>
                      <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-slate-500">
                        {formatDate(log.timestamp)}
                      </p>
                    </li>
                  ))}
                  {selectedAutomation.logs.length === 0 ? (
                    <li className="rounded-xl border border-dashed border-white/10 bg-slate-900/30 p-4 text-slate-500">
                      Send emails or generate drafts to populate the timeline.
                    </li>
                  ) : null}
                </ul>
              </div>
            </section>
          </>
        ) : (
          <section className="rounded-3xl bg-slate-900/60 p-6 text-center text-sm text-slate-300 ring-1 ring-white/10">
            Add an automation to get started.
          </section>
        )}
      </div>
    </div>
  );
}

type RecipientQuickFormProps = {
  onCreate: (recipient: Omit<Recipient, 'id' | 'status'>) => void;
};

function RecipientQuickForm({ onCreate }: RecipientQuickFormProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');

  const reset = () => {
    setName('');
    setEmail('');
    setCompany('');
    setRole('');
  };

  const handleCreate = () => {
    if (!name || !email) return;
    onCreate({
      name,
      email,
      company,
      role,
      customFields: {},
      previewHtml: undefined,
      previewSubject: undefined,
      previewText: undefined,
      lastError: undefined,
    });
    reset();
  };

  return (
    <div className="rounded-2xl bg-slate-950/30 p-4 ring-1 ring-white/10">
      <h3 className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-300">
        Add manually
      </h3>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Full name"
          className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40"
        />
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email"
          className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40"
        />
        <input
          value={company}
          onChange={(event) => setCompany(event.target.value)}
          placeholder="Company"
          className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40"
        />
        <input
          value={role}
          onChange={(event) => setRole(event.target.value)}
          placeholder="Role"
          className="rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/40"
        />
      </div>
      <button
        type="button"
        onClick={handleCreate}
        disabled={!name || !email}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-white/10 py-2 text-sm font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <PlusIcon className="h-4 w-4" />
        Add recipient
      </button>
    </div>
  );
}
