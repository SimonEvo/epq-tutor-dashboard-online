const KEY = 'epq_zoom_configs'

export interface ZoomConfig {
  id: string
  name: string        // 账号名称（友好显示）
  accountId: string
  clientId: string
  clientSecret: string
}

export function getZoomConfigs(): ZoomConfig[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]')
  } catch {
    return []
  }
}

export function saveZoomConfigs(configs: ZoomConfig[]): void {
  localStorage.setItem(KEY, JSON.stringify(configs))
}

export function addZoomConfig(cfg: Omit<ZoomConfig, 'id'>): ZoomConfig {
  const configs = getZoomConfigs()
  const newCfg: ZoomConfig = { ...cfg, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }
  saveZoomConfigs([...configs, newCfg])
  return newCfg
}

export function updateZoomConfig(id: string, patch: Partial<Omit<ZoomConfig, 'id'>>): void {
  saveZoomConfigs(getZoomConfigs().map(c => c.id === id ? { ...c, ...patch } : c))
}

export function deleteZoomConfig(id: string): void {
  saveZoomConfigs(getZoomConfigs().filter(c => c.id !== id))
}

// ── Meeting → config mapping ──────────────────────────────────────────────────
// Records which ZoomConfig was used to create each meeting, keyed by meetingId.

const MEETING_CONFIG_MAP_KEY = 'epq_zoom_meeting_config_map'

function getMeetingConfigMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(MEETING_CONFIG_MAP_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function saveMeetingConfigId(meetingId: string, configId: string): void {
  const map = getMeetingConfigMap()
  localStorage.setItem(MEETING_CONFIG_MAP_KEY, JSON.stringify({ ...map, [meetingId]: configId }))
}

export function getMeetingConfigId(meetingId: string): string | undefined {
  return getMeetingConfigMap()[meetingId]
}

export function removeMeetingConfigId(meetingId: string): void {
  const map = getMeetingConfigMap()
  delete map[meetingId]
  localStorage.setItem(MEETING_CONFIG_MAP_KEY, JSON.stringify(map))
}
