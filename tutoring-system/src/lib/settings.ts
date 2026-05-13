const KEY = 'epq_app_settings'

export interface AppSettings {
  wecomWebhookUrl: string
  aiApiKey: string
  aiModel: string
  aiBaseUrl: string
  sessionReportTemplate: string   // empty = use built-in default
  progressReportTemplate: string  // empty = use built-in default
}

const DEFAULTS: AppSettings = {
  wecomWebhookUrl: '',
  aiApiKey: '',
  aiModel: 'qwen-plus',
  aiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  sessionReportTemplate: '',
  progressReportTemplate: '',
}

export function getSettings(): AppSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(KEY, JSON.stringify(s))
}

export const AI_PROVIDERS = [
  { label: '阿里云百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { label: 'DeepSeek',   baseUrl: 'https://api.deepseek.com',                       model: 'deepseek-v4-flash' },
  { label: 'OpenAI',     baseUrl: 'https://api.openai.com/v1',                         model: 'gpt-4o' },
] as const
