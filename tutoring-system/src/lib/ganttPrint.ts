import type { GanttProject, GanttTask, SessionRecord, Student, Supervisor } from '@/types'
import {
  SESSION_LABEL, FIXED_SECTION, FIXED_DEFAULT_COLOR, sessionColor,
  SA_ZHONGFANG_COLOR, SESSION_COLOR, SA_ZHONGFANG_DEFENSE_COLOR, SA_YINGFANG_DEFENSE_COLOR,
} from '@/lib/ganttColors'

/**
 * 把甘特图排成一张超宽的打印页，交给浏览器的「另存为 PDF」。
 *
 * 走打印而不是 jsPDF/html2canvas：文字是真文字（可选可搜、放大不糊），
 * 也不用为了一个导出功能背 1MB 依赖。@page 尺寸按内容算，所以是一整页，
 * 不会被切成 A4 碎片。
 *
 * 时间轴右端截到今天——导出的是「这一学期上过的课」，不是排期表。
 */

const COL_W = 22          // 打印用的列宽，屏幕上是 64
const ROW_H = 26
const NAME_W = 120
const HEADER_H = 34

function pad(n: number) { return String(n).padStart(2, '0') }
function toISO(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r }
function daysBetween(a: Date, b: Date) { return Math.round((b.getTime() - a.getTime()) / 86400000) }
function parseISO(iso: string) { return new Date(iso + 'T12:00:00') }

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const PRINTABLE_TYPES = new Set(['SA_MEETING', 'TA_MEETING', 'THEORY'])

export interface GanttPrintInput {
  /** 当前视图里显示的学生（已按届过滤） */
  students: Student[]
  supervisors: Supervisor[]
  project: GanttProject | null
  /** 标题里写的范围，如「2026-1月届」/「全部」 */
  roundLabel: string
}

export function printGantt({ students, supervisors, project, roundLabel }: GanttPrintInput): string | null {
  const todayISO = toISO(new Date())
  const supervisorById = new Map(supervisors.map(sv => [sv.id, sv]))

  // ── 范围：显示中的学生上过的课（截到今天） ────────────────────────────────
  let minISO: string | null = null
  let maxISO: string | null = null
  for (const s of students) {
    for (const sess of s.sessions ?? []) {
      if (!PRINTABLE_TYPES.has(sess.type)) continue
      if (sess.date > todayISO) continue
      if (!minISO || sess.date < minISO) minISO = sess.date
      if (!maxISO || sess.date > maxISO) maxISO = sess.date
    }
  }
  if (!minISO || !maxISO) return '这一届还没有已上的课，没什么可导出的'

  const rangeStart = addDays(parseISO(minISO), -3)
  const rangeEnd = addDays(parseISO(maxISO), 3)
  const totalDays = daysBetween(rangeStart, rangeEnd) + 1
  const dates = Array.from({ length: totalDays }, (_, i) => addDays(rangeStart, i))
  const startISO = toISO(rangeStart)
  const endISO = toISO(rangeEnd)
  const colIdx = (iso: string) => daysBetween(rangeStart, parseISO(iso))

  // ── 甘特任务按 section 归位 ──────────────────────────────────────────────
  const sectionIdByName = new Map((project?.data?.sections ?? []).map(sec => [sec.name, sec.id]))
  const tasksBySection = new Map<string, GanttTask[]>()
  for (const t of project?.data?.tasks ?? []) {
    if (!t.sectionId) continue
    const arr = tasksBySection.get(t.sectionId)
    if (arr) arr.push(t)
    else tasksBySection.set(t.sectionId, [t])
  }
  const fixedSectionId = sectionIdByName.get(FIXED_SECTION)
  const fixedTasks = (fixedSectionId ? tasksBySection.get(fixedSectionId) : undefined) ?? []

  // ── 月份表头 ─────────────────────────────────────────────────────────────
  const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
  const monthSpans: { label: string; count: number }[] = []
  for (const d of dates) {
    const label = `${d.getFullYear()}年${MONTHS[d.getMonth()]}`
    const last = monthSpans[monthSpans.length - 1]
    if (last && last.label === label) last.count++
    else monthSpans.push({ label, count: 1 })
  }

  const gridW = totalDays * COL_W
  const rows = students.filter(s => (s.sessions ?? []).some(
    sess => PRINTABLE_TYPES.has(sess.type) && sess.date <= todayISO && sess.date >= startISO,
  ))
  if (rows.length === 0) return '这一届还没有已上的课，没什么可导出的'

  const pageW = NAME_W + gridW + 48
  const pageH = HEADER_H * 2 + (rows.length + 1) * ROW_H + 150   // +1 = 固定安排那一行

  // 周末底色用和屏幕版一样的渐变技巧：图案按周日起画，再平移到起始日的星期
  const startWeekday = rangeStart.getDay()

  // ── 固定安排：整列淡色带，压在所有行下面 ──────────────────────────────────
  const fixedBands = fixedTasks.map(t => {
    const color = t.color ?? FIXED_DEFAULT_COLOR
    if (t.milestone || !t.endDate) {
      const i = colIdx(t.startDate)
      if (i < 0 || i >= totalDays) return ''
      return `<div class="band" style="left:${i * COL_W + COL_W / 2 - 1}px;width:2px;background:${color};opacity:.45"></div>`
    }
    const cs = Math.max(0, colIdx(t.startDate))
    const ce = Math.min(totalDays - 1, colIdx(t.endDate))
    if (cs > ce) return ''
    return `<div class="band" style="left:${cs * COL_W}px;width:${(ce - cs + 1) * COL_W}px;background:${color};opacity:.12"></div>`
  }).join('')

  // ── 固定安排行：和屏幕版一样，单独一行把出差 / deadline 的名字写出来 ────────
  const fixedRow = fixedTasks.length === 0 ? '' : `<div class="row fixedrow">
    <div class="name"><span class="nm">固定安排</span></div>
    <div class="lane">${fixedBands}${fixedTasks.map(t => {
      const color = t.color ?? FIXED_DEFAULT_COLOR
      if (t.milestone || !t.endDate) {
        const i = colIdx(t.startDate)
        if (i < 0 || i >= totalDays) return ''
        return `<div class="fx-ms" style="left:${i * COL_W + COL_W / 2}px;color:${color}">`
          + `◆<span>${esc(t.name)}</span></div>`
      }
      const cs = Math.max(0, colIdx(t.startDate))
      const ce = Math.min(totalDays - 1, colIdx(t.endDate))
      if (cs > ce) return ''
      return `<div class="fx-bar" style="left:${cs * COL_W}px;width:${(ce - cs + 1) * COL_W}px;background:${color}">`
        + `<span>${esc(t.name)}</span></div>`
    }).join('')}</div>
  </div>`

  // ── 每个学生一行 ─────────────────────────────────────────────────────────
  const rowHtml = rows.map(s => {
    const isZhongFangSA = s.supervisorId
      ? supervisorById.get(s.supervisorId)?.saType === '中方SA'
      : false

    const sessions = (s.sessions ?? []).filter(
      (sess: SessionRecord) => PRINTABLE_TYPES.has(sess.type)
        && sess.date >= startISO && sess.date <= endISO && sess.date <= todayISO,
    )

    const marks = sessions.map(sess => {
      const i = colIdx(sess.date)
      if (i < 0 || i >= totalDays) return ''
      const color = sessionColor(sess.type, { isZhongFangSA, isFinalDefense: sess.isFinalDefense })
      const tip = `${SESSION_LABEL[sess.type] ?? sess.type}${sess.isFinalDefense ? '·最终答辩' : ''} ${sess.date}`
      return `<div class="mark" style="left:${i * COL_W + COL_W / 2}px;background:${color}" title="${esc(tip)}"></div>`
    }).join('')

    const secId = sectionIdByName.get(s.name)
    const bars = (secId ? tasksBySection.get(secId) ?? [] : []).map(t => {
      if (t.milestone) {
        const i = colIdx(t.startDate)
        if (i < 0 || i >= totalDays) return ''
        return `<div class="ms" style="left:${i * COL_W + COL_W / 2}px">◆</div>`
      }
      if (!t.startDate || !t.endDate) return ''
      const cs = Math.max(0, colIdx(t.startDate))
      const ce = Math.min(totalDays - 1, colIdx(t.endDate))
      if (cs > ce) return ''
      const color = t.color ?? '#6366f1'
      return `<div class="bar" style="left:${cs * COL_W}px;width:${(ce - cs + 1) * COL_W}px;background:${color}">`
        + `<span>${esc(t.name)}</span></div>`
    }).join('')

    const count = sessions.length
    return `<div class="row">
      <div class="name"><span class="nm">${esc(s.name)}</span><span class="ct">${count} 节</span></div>
      <div class="lane">${fixedBands}${bars}${marks}</div>
    </div>`
  }).join('')

  const totalSessions = rows.reduce((n, s) => n + (s.sessions ?? []).filter(
    sess => PRINTABLE_TYPES.has(sess.type) && sess.date >= startISO && sess.date <= todayISO,
  ).length, 0)

  const legend = [
    ['中方SA', SA_ZHONGFANG_COLOR],
    ['英方SA', SESSION_COLOR.SA_MEETING],
    ['TA', SESSION_COLOR.TA_MEETING],
    ['理论', SESSION_COLOR.THEORY],
    ['答辩(中方)', SA_ZHONGFANG_DEFENSE_COLOR],
    ['答辩(英方)', SA_YINGFANG_DEFENSE_COLOR],
  ].map(([label, color]) => `<span class="lg"><i style="background:${color}"></i>${label}</span>`).join('')

  const dayCells = dates.map(d => {
    const wknd = d.getDay() === 0 || d.getDay() === 6
    return `<div class="day${wknd ? ' wk' : ''}">${d.getDate()}</div>`
  }).join('')

  const monthCells = monthSpans
    .map(m => `<div class="mon" style="width:${m.count * COL_W}px">${m.label}</div>`)
    .join('')

  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>课程记录 ${esc(roundLabel)} ${startISO}~${todayISO}</title>
<style>
  @page { size: ${pageW}px ${pageH}px; margin: 24px; }
  * { box-sizing: border-box; }
  body { margin:0; font: 12px/1.4 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color:#111827;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1 { font-size:18px; margin:0 0 4px; }
  .meta { font-size:12px; color:#6b7280; margin-bottom:8px; }
  .legend { display:flex; gap:12px; flex-wrap:wrap; font-size:11px; color:#6b7280; margin-bottom:10px; }
  .lg { display:flex; align-items:center; gap:4px; }
  .lg i { width:9px; height:9px; border-radius:2px; display:inline-block; }
  .chart { width:${NAME_W + gridW}px; border:1px solid #e5e7eb; }
  .hdr { display:flex; border-bottom:1px solid #e5e7eb; background:#f9fafb; }
  .hdr .pad { width:${NAME_W}px; flex:none; border-right:1px solid #e5e7eb; }
  .months, .days { display:flex; }
  .mon { flex:none; text-align:center; font-size:11px; color:#4b5563; padding:3px 0;
         border-left:1px solid #e5e7eb; }
  .day { width:${COL_W}px; flex:none; text-align:center; font-size:9px; color:#9ca3af; padding:2px 0;
         border-left:1px solid #f3f4f6; }
  .day.wk { color:#d1d5db; background:#f9fafb; }
  .row { display:flex; border-bottom:1px solid #f3f4f6; height:${ROW_H}px; break-inside:avoid; }
  .name { width:${NAME_W}px; flex:none; border-right:1px solid #e5e7eb; padding:0 8px;
          display:flex; align-items:center; justify-content:space-between; gap:6px; overflow:hidden; }
  .nm { font-size:11px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ct { font-size:9px; color:#9ca3af; flex:none; }
  .lane { position:relative; width:${gridW}px; flex:none;
    background-image:
      repeating-linear-gradient(to right, #f3f4f6 0 1px, transparent 1px ${COL_W}px),
      linear-gradient(to right, rgba(249,250,251,.75) 0 ${COL_W}px, transparent ${COL_W}px ${6 * COL_W}px, rgba(249,250,251,.75) ${6 * COL_W}px ${7 * COL_W}px);
    background-size: ${COL_W}px 100%, ${7 * COL_W}px 100%;
    background-position: 0 0, ${-startWeekday * COL_W}px 0;
  }
  .band { position:absolute; top:0; bottom:0; }
  .fixedrow { background:#fafafa; border-bottom:1px solid #e5e7eb; }
  .fixedrow .nm { color:#6b7280; font-weight:500; }
  .fx-bar { position:absolute; top:50%; transform:translateY(-50%); height:14px; border-radius:2px;
            opacity:.9; overflow:hidden; display:flex; align-items:center; padding-left:3px; }
  .fx-bar span { font-size:8px; color:#fff; font-weight:600; white-space:nowrap; }
  .fx-ms { position:absolute; top:50%; transform:translate(-50%,-50%); font-size:9px;
           display:flex; align-items:center; gap:2px; white-space:nowrap; }
  .fx-ms span { font-size:8px; font-weight:600; }
  .bar { position:absolute; top:50%; transform:translateY(-50%); height:13px; border-radius:2px;
         opacity:.85; overflow:hidden; display:flex; align-items:center; padding-left:3px; }
  .bar span { font-size:8px; color:#fff; white-space:nowrap; }
  .ms { position:absolute; top:50%; transform:translate(-50%,-50%); font-size:11px; color:#3b82f6; }
  .mark { position:absolute; top:50%; width:9px; height:9px; border-radius:2px;
          transform:translate(-50%,-50%); }
  .foot { margin-top:10px; font-size:11px; color:#6b7280; }
</style></head><body>
<h1>课程记录 · ${esc(roundLabel)}</h1>
<div class="meta">${startISO} – ${todayISO} &ensp;共 ${rows.length} 名学生 / ${totalSessions} 节课 &ensp;（生成于 ${todayISO}）</div>
<div class="legend">${legend}<span class="lg"><i style="background:${FIXED_DEFAULT_COLOR};opacity:.5"></i>固定安排</span></div>
<div class="chart">
  <div class="hdr"><div class="pad"></div><div class="months">${monthCells}</div></div>
  <div class="hdr"><div class="pad"></div><div class="days">${dayCells}</div></div>
  ${fixedRow}
  ${rowHtml}
</div>
<div class="foot">只统计已上的课（截至 ${todayISO}），不含未来排期。</div>
</body></html>`

  const win = window.open('', '_blank')
  if (!win) return '浏览器拦截了新窗口，请允许弹窗后重试'
  win.document.write(html)
  win.document.close()
  // 等布局稳定再拉打印对话框，否则 Chrome 偶尔按空白页算尺寸
  win.addEventListener('load', () => setTimeout(() => win.print(), 120))
  return null
}
