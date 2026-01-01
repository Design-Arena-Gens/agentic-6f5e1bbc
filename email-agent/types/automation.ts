export type RecipientStatus = 'pending' | 'drafted' | 'sent' | 'failed';

export type Recipient = {
  id: string;
  name: string;
  email: string;
  company?: string;
  role?: string;
  customFields: Record<string, string>;
  status: RecipientStatus;
  lastError?: string;
  previewSubject?: string;
  previewHtml?: string;
  previewText?: string;
};

export type AutomationLogEntry = {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  recipientId?: string;
};

export type Automation = {
  id: string;
  name: string;
  goal: string;
  senderName: string;
  senderEmail: string;
  replyTo?: string;
  subjectTemplate: string;
  bodyTemplate: string;
  plainTextTemplate?: string;
  aiDrafting: boolean;
  openAiModel: string;
  recipients: Recipient[];
  cooldownMinutes: number;
  batchSize: number;
  enableTracking: boolean;
  status: 'idle' | 'drafting' | 'sending';
  logs: AutomationLogEntry[];
  lastRunAt?: string;
};

export type DraftRequest = {
  instructions: string;
  recipient: Recipient;
  automation: Pick<
    Automation,
    'goal' | 'subjectTemplate' | 'bodyTemplate' | 'plainTextTemplate'
  >;
  openAiKey: string;
  openAiModel: string;
};

export type DraftResponse = {
  subject: string;
  html: string;
  text: string;
};

