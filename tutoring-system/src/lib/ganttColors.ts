/**
 * 甘特图配色。抽出来给「导出 PDF」共用，免得打印版和屏幕版颜色跑偏。
 *
 * 注意：周日程（WeekScheduleView）的英方SA 是弱化灰，这里是 salmon——刻意不同，
 * 甘特图要靠这个底色衬托课后反馈状态环。别去「统一」。
 */

export const SESSION_COLOR: Record<string, string> = {
  SA_MEETING: '#FA8072',
  TA_MEETING: '#3b82f6',
  THEORY: '#22c55e',
}

export const SESSION_LABEL: Record<string, string> = {
  SA_MEETING: 'SA会议',
  TA_MEETING: 'TA会议',
  THEORY: '理论课',
}

// SA 课后反馈状态环：已发送=绿；未发送且已到第 3 个工作日（含逾期）=黄
export const FEEDBACK_DONE_RING = '#16a34a'
export const FEEDBACK_DUE_RING = '#eab308'

// 中方SA（tutor 亲自当 SA）会议用温和 prince 紫区分
export const SA_ZHONGFANG_COLOR = '#9575CD'
// 最终答辩：无论中英方都要出席，配色单独拉出来强调
export const SA_ZHONGFANG_DEFENSE_COLOR = '#A21CAF'  // 紫红
export const SA_YINGFANG_DEFENSE_COLOR = '#db4d4d'   // 醒目红

export const FIXED_SECTION = '固定安排'
export const FIXED_DEFAULT_COLOR = '#f59e0b'

/** 一个 session 在甘特图里该用什么颜色 */
export function sessionColor(
  type: string,
  opts: { isZhongFangSA?: boolean; isFinalDefense?: boolean } = {},
): string {
  if (type !== 'SA_MEETING') return SESSION_COLOR[type] ?? '#9CA3AF'
  if (opts.isFinalDefense) {
    return opts.isZhongFangSA ? SA_ZHONGFANG_DEFENSE_COLOR : SA_YINGFANG_DEFENSE_COLOR
  }
  return opts.isZhongFangSA ? SA_ZHONGFANG_COLOR : SESSION_COLOR.SA_MEETING
}
