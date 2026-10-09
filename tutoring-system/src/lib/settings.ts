const KEY = 'epq_app_settings'

// AI 凭据（key / model / baseUrl）已收到服务端的机构配置，不再存在本地 —— 见
// epq-tutor-backend/app/ai_config.py。localStorage 里旧的 aiApiKey 等字段会被忽略。
export interface AppSettings {
  wecomWebhookUrl: string
  sessionReportTemplate: string   // empty = use built-in default
  progressReportTemplate: string  // empty = use built-in default
  weeklyReportOutputTemplate: string // empty = use built-in default
}

const DEFAULTS: AppSettings = {
  wecomWebhookUrl: '',
  sessionReportTemplate: '',
  progressReportTemplate: '',
  weeklyReportOutputTemplate: '',
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
