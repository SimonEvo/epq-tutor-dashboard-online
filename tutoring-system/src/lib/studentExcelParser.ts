/**
 * 学生导入表解析：Excel → 规范化的导入行。
 *
 * 表头**自动识别**，不依赖固定列顺序 —— 教务导出的表列序常变，写死列号每次都得改。
 * 做法沿用教务系统 frontend/src/utils/projectExcelParser.ts：给每个字段一组别名，
 * 对前 15 行逐行打分找出表头行，再按列号取值。
 *
 * 解析放前端：文件不必上传，隐私更好，后端也不用处理二进制。后端只收结构化行。
 */
import * as XLSX from 'xlsx'

export interface ImportRow {
  name: string
  nameEn?: string
  gender?: string
  school?: string
  currentGrade?: string
  contact?: string
  registrationRound?: string
  submissionRound?: string
  isOneYear?: boolean
  universityAspiration?: string
  taughtElementType?: string
  universityEnrollment?: string
  topic?: string
  topicZh?: string
  overview?: string
  saHoursTotal?: number
  supervisorName?: string
  briefNote?: string
  availabilityNote?: string
  /** 只用于解析一年期起始轮次，不入库 */
  classBatch?: string
}

export interface ParseResult {
  rows: ImportRow[]
  warnings: string[]
  matchedColumns: string[]
}

type FieldKey = keyof ImportRow

const FIELD_ALIASES: Record<string, string[]> = {
  name: ['学生姓名', '中文姓名', '姓名', 'Student Name', 'Name'],
  nameEn: ['英文名', '英文姓名', 'English Name', '名拼音', '拼音'],
  lastNamePinyin: ['姓拼音', '姓（拼音）', 'Last Name'],
  gender: ['性别', 'Gender'],
  school: ['学校', '就读学校', '所在学校', 'School'],
  currentGrade: ['年级', 'Grade'],
  phone: ['手机号', '手机', '电话', '联系电话', 'Phone', 'Mobile'],
  email: ['学生邮箱', '邮箱', 'Email', 'E-mail'],
  contact: ['联系方式', 'Contact'],
  registrationRound: ['报名学期', '报名轮次', '入学学期', '学期', 'Intake Term', 'Term'],
  submissionRound: ['提交学期', '提交轮次', '提交批次', 'Submission Round'],
  classBatch: ['报名班期', '班期', 'Class Batch', 'Batch'],
  oneYear: ['一年期', '学制', 'One Year'],
  universityAspiration: ['大学方向', '意向专业', '大学想学习的方向', '意向方向'],
  taughtElementType: ['授课类型', 'Taught Element'],
  universityEnrollment: ['升学', '入学年份', 'Enrollment'],
  topic: ['课题', '选题', '确认选题方向', '初始选题方向', 'Topic'],
  topicZh: ['中文课题', '课题中文', '中文选题'],
  overview: ['概述', '项目概述', 'Overview'],
  saHoursTotal: ['SA总课时', 'SA课时', 'SA 总课时'],
  supervisorName: ['督导', '英方SA', 'SA', 'SA姓名', 'Supervisor'],
  briefNote: ['简报', '备注', '特殊情况备注', 'Remark', 'Note'],
  availabilityNote: ['可用时间', '时间安排', 'Availability'],
}

function normalizeHeader(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/[（）]/g, m => (m === '（' ? '(' : ')'))
    .replace(/[\s\u3000:：/\\|,，.。;；"'`’‘“”()[\]{}【】<>《》_-]+/g, '')
}

const ALIAS_INDEX = Object.entries(FIELD_ALIASES).flatMap(([field, aliases]) =>
  aliases.map(alias => ({ field, normalized: normalizeHeader(alias) })),
)

/** 打分匹配：完全相等 > 表头包含别名 > 别名包含表头。分数里加长度，长别名优先。 */
function matchHeader(header: unknown): string | null {
  const h = normalizeHeader(header)
  if (!h) return null
  let best: { field: string; score: number } | null = null
  for (const { field, normalized } of ALIAS_INDEX) {
    if (!normalized) continue
    let score = 0
    if (h === normalized) score = 100 + normalized.length
    else if (h.includes(normalized) && normalized.length >= 2) score = 70 + normalized.length
    else if (normalized.includes(h) && h.length >= 3) score = 55 + h.length
    if (score > 0 && (!best || score > best.score)) best = { field, score }
  }
  return best?.field ?? null
}

/** 表头未必在第一行（教务的表常有标题行、合并单元格），前 15 行里挑得分最高的。 */
function detectHeaderRow(rows: unknown[][]): { index: number; byColumn: Map<number, string> } | null {
  type Candidate = { index: number; byColumn: Map<number, string>; score: number }
  // 用 for 而不是 forEach：回调里赋值会让 TS 把 best 收窄成 never。
  let best: Candidate | null = null
  const head = rows.slice(0, 15)
  for (let index = 0; index < head.length; index++) {
    const byColumn = new Map<number, string>()
    const seen = new Set<string>()
    head[index].forEach((cell, col) => {
      const field = matchHeader(cell)
      if (!field || seen.has(field)) return
      byColumn.set(col, field)
      seen.add(field)
    })
    const bonus = (seen.has('name') ? 3 : 0) + (seen.has('school') ? 2 : 0)
    const score = seen.size + bonus
    if (score > 0 && (best === null || score > best.score)) best = { index, byColumn, score }
  }
  return best !== null && best.score >= 3 ? { index: best.index, byColumn: best.byColumn } : null
}

const str = (v: unknown): string | undefined => {
  const s = String(v ?? '').trim()
  return s || undefined
}

const TRUTHY = ['是', 'y', 'yes', 'true', '1', '一年期']

function parseBool(v: unknown): boolean {
  const s = String(v ?? '').trim().toLowerCase()
  return TRUTHY.includes(s)
}

/**
 * 本系统 gender 的规范值是 Male / Female / Other（界面上才显示男/女/其他，
 * 见 StudentFormFields 的 option value）。导入必须落到这套词表上 ——
 * 写成「男」表单下拉会选不中，且一次导入就把全库的取值搞成两套。
 */
function parseGender(v: unknown): string | undefined {
  const s = String(v ?? '').trim().toLowerCase()
  if (['男', 'male', 'm', '男生'].includes(s)) return 'Male'
  if (['女', 'female', 'f', '女生'].includes(s)) return 'Female'
  return str(v) ? 'Other' : undefined
}

function buildRow(raw: Record<string, unknown>): ImportRow {
  // contact 在本系统是单字段：手机优先，其次邮箱，最后是笼统的「联系方式」列
  const contact = str(raw.phone) ?? str(raw.email) ?? str(raw.contact)
  // 英文名可能被拆成姓/名两列
  const nameEn = [str(raw.lastNamePinyin), str(raw.nameEn)].filter(Boolean).join(' ') || undefined
  const saHours = Number(str(raw.saHoursTotal))

  return {
    name: str(raw.name) ?? '',
    nameEn,
    gender: parseGender(raw.gender),
    school: str(raw.school),
    currentGrade: str(raw.currentGrade),
    contact,
    registrationRound: str(raw.registrationRound),
    submissionRound: str(raw.submissionRound),
    isOneYear: raw.oneYear === undefined ? undefined : parseBool(raw.oneYear),
    universityAspiration: str(raw.universityAspiration),
    taughtElementType: str(raw.taughtElementType),
    universityEnrollment: str(raw.universityEnrollment),
    topic: str(raw.topic),
    topicZh: str(raw.topicZh),
    overview: str(raw.overview),
    saHoursTotal: Number.isFinite(saHours) && saHours > 0 ? saHours : undefined,
    supervisorName: str(raw.supervisorName),
    briefNote: str(raw.briefNote),
    availabilityNote: str(raw.availabilityNote),
    classBatch: str(raw.classBatch),
  }
}

export function readWorkbook(file: File): Promise<XLSX.WorkBook> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.onload = e => {
      try {
        resolve(XLSX.read(e.target?.result, { type: 'array' }))
      } catch {
        reject(new Error('Excel 解析失败，请确认文件没有损坏'))
      }
    }
    reader.readAsArrayBuffer(file)
  })
}

export function sheetNames(wb: XLSX.WorkBook): string[] {
  return wb.SheetNames
}

export function parseSheet(wb: XLSX.WorkBook, sheetName: string): ParseResult {
  const sheet = wb.Sheets[sheetName]
  if (!sheet) return { rows: [], warnings: [`找不到工作表「${sheetName}」`], matchedColumns: [] }

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' })
  const header = detectHeaderRow(grid)
  if (!header) {
    return {
      rows: [],
      warnings: ['没能识别出表头行。请确认表里有「姓名」「学校」这类列名，且在前 15 行内。'],
      matchedColumns: [],
    }
  }

  const warnings: string[] = []
  const rows: ImportRow[] = []
  grid.slice(header.index + 1).forEach(line => {
    if (!line.some(c => String(c ?? '').trim())) return   // 整行空，跳过
    const raw: Record<string, unknown> = {}
    header.byColumn.forEach((field, col) => { raw[field] = line[col] ?? '' })
    const row = buildRow(raw)
    if (!row.name.trim()) {
      warnings.push(`有一行姓名为空，已跳过（学校：${row.school ?? '—'}）`)
      return
    }
    rows.push(row)
  })

  const matched = [...new Set(header.byColumn.values())] as FieldKey[]
  if (!matched.includes('name')) warnings.push('没识别到姓名列，导入无法进行。')
  return { rows, warnings, matchedColumns: matched as string[] }
}

export async function parseExcelFile(file: File, sheetName?: string): Promise<ParseResult> {
  const wb = await readWorkbook(file)
  return parseSheet(wb, sheetName ?? wb.SheetNames[0])
}
