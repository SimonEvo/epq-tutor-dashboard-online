import { create } from 'zustand'
import * as dataService from '@/lib/dataService'
import { publishCalendar } from '@/lib/calendarService'
import type { Student, Supervisor, ChecklistCustomItem, DeadlineTier, TiiCheck } from '@/types'

export type CalendarSyncStatus = 'idle' | 'syncing' | 'ok' | 'err'

interface StudentState {
  students: Student[]
  tags: string[]
  rounds: string[]
  supervisors: Supervisor[]
  isLoading: boolean
  error: string | null
  calendarSync: CalendarSyncStatus
  calendarUrl: string | null
  fetchAll: () => Promise<void>
  fetchTags: () => Promise<void>
  fetchRounds: () => Promise<void>
  fetchSupervisors: () => Promise<void>
  saveStudent: (student: Student) => Promise<void>
  deleteStudent: (id: string) => Promise<void>
  patchHomeworkItem: (studentId: string, entryId: string, itemIdx: number, done: boolean) => Promise<void>
  saveTags: (tags: string[]) => Promise<void>
  saveRounds: (rounds: string[]) => Promise<void>
  saveSupervisor: (supervisor: Supervisor) => Promise<void>
  deleteSupervisor: (id: string) => Promise<void>
  // ── 提交（窄端点 + 乐观更新）──────────────────────────────────────────────
  patchLocalStudent: (id: string, patch: Partial<Student>) => void
  toggleChecklistItem: (studentId: string, itemId: string, checked: boolean) => Promise<void>
  saveChecklistCustomItems: (studentId: string, items: ChecklistCustomItem[]) => Promise<void>
  patchDeadline: (studentId: string, body: { tier?: DeadlineTier; override?: string | null; confirmed?: boolean }) => Promise<void>
  setWrappedUp: (studentId: string, wrappedUp: boolean) => Promise<void>
  saveTiiChecks: (studentId: string, checks: TiiCheck[]) => Promise<void>
  setDefenseConfirmed: (studentId: string, confirmed: boolean) => Promise<void>
}

export const useStudentStore = create<StudentState>((set, get) => ({
  students: [],
  tags: [],
  rounds: [],
  supervisors: [],
  isLoading: false,
  error: null,
  calendarSync: 'idle',
  calendarUrl: null,

  fetchAll: async () => {
    // 只有第一次（没有缓存数据）才显示 loading，之后静默刷新避免闪烁
    if (get().students.length === 0) set({ isLoading: true, error: null })
    try {
      const students = await dataService.listStudents()
      if (students.length > 0 || get().students.length === 0) {
        set({ students, isLoading: false })
      } else {
        set({ isLoading: false })
      }
    } catch (e) {
      set({ error: String(e), isLoading: false })
    }
  },

  fetchTags: async () => {
    const tags = await dataService.getTags()
    set({ tags })
  },

  fetchRounds: async () => {
    const rounds = await dataService.getRounds()
    set({ rounds })
  },

  fetchSupervisors: async () => {
    const supervisors = await dataService.listSupervisors()
    set({ supervisors })
  },

  saveStudent: async (student: Student) => {
    await dataService.saveStudent(student)
    const students = get().students
    const idx = students.findIndex(s => s.id === student.id)
    const updatedStudents = idx >= 0
      ? students.map(s => s.id === student.id ? student : s)
      : [...students, student]
    set({ students: updatedStudents, calendarSync: 'syncing' })
    publishCalendar(updatedStudents)
      .then((url) => {
        set({ calendarSync: 'ok', ...(url ? { calendarUrl: url } : {}) })
        setTimeout(() => set({ calendarSync: 'idle' }), 3000)
      })
      .catch(() => {
        set({ calendarSync: 'err' })
        setTimeout(() => set({ calendarSync: 'idle' }), 5000)
      })
  },

  deleteStudent: async (id: string) => {
    await dataService.deleteStudent(id)
    set({ students: get().students.filter(s => s.id !== id) })
  },

  patchHomeworkItem: async (studentId, entryId, itemIdx, done) => {
    await dataService.toggleHomeworkItem(studentId, entryId, itemIdx, done)
    set({
      students: get().students.map(s => {
        if (s.id !== studentId || !s.latestHomeworkEntry || s.latestHomeworkEntry.id !== entryId) return s
        const items = s.latestHomeworkEntry.items.map((item, i) =>
          i === itemIdx ? { ...item, done } : item
        )
        return { ...s, latestHomeworkEntry: { ...s.latestHomeworkEntry, items } }
      }),
    })
  },

  saveTags: async (tags: string[]) => {
    await dataService.saveTags(tags)
    set({ tags })
  },

  saveRounds: async (rounds: string[]) => {
    await dataService.saveRounds(rounds)
    set({ rounds })
  },

  saveSupervisor: async (supervisor: Supervisor) => {
    await dataService.saveSupervisor(supervisor)
    const existing = get().supervisors
    const idx = existing.findIndex(s => s.id === supervisor.id)
    set({ supervisors: idx >= 0 ? existing.map(s => s.id === supervisor.id ? supervisor : s) : [...existing, supervisor] })
  },

  deleteSupervisor: async (id: string) => {
    await dataService.deleteSupervisor(id)
    set({ supervisors: get().supervisors.filter(s => s.id !== id) })
  },

  // ── 提交（窄端点，绝不触发全量学生保存）────────────────────────────────────

  patchLocalStudent: (id, patch) => {
    set({ students: get().students.map(s => (s.id === id ? { ...s, ...patch } : s)) })
  },

  toggleChecklistItem: async (studentId, itemId, checked) => {
    const before = get().students.find(s => s.id === studentId)?.submissionChecklist
    const current = before ?? { ticked: {}, customItems: [] }
    const ticked = { ...current.ticked }
    if (checked) ticked[itemId] = new Date().toISOString()
    else delete ticked[itemId]
    // 乐观更新
    get().patchLocalStudent(studentId, { submissionChecklist: { ...current, ticked } })
    try {
      const saved = await dataService.patchChecklistTick(studentId, itemId, checked)
      get().patchLocalStudent(studentId, { submissionChecklist: saved })
    } catch (e) {
      get().patchLocalStudent(studentId, { submissionChecklist: before })  // 失败回滚
      throw e
    }
  },

  saveChecklistCustomItems: async (studentId, items) => {
    const before = get().students.find(s => s.id === studentId)?.submissionChecklist
    const current = before ?? { ticked: {}, customItems: [] }
    get().patchLocalStudent(studentId, { submissionChecklist: { ...current, customItems: items } })
    try {
      const saved = await dataService.patchChecklistCustomItems(studentId, items)
      get().patchLocalStudent(studentId, { submissionChecklist: saved })
    } catch (e) {
      get().patchLocalStudent(studentId, { submissionChecklist: before })
      throw e
    }
  },

  patchDeadline: async (studentId, body) => {
    const saved = await dataService.patchStudentDeadline(studentId, body)
    get().patchLocalStudent(studentId, saved)
  },

  setWrappedUp: async (studentId, wrappedUp) => {
    const wrappedUpAt = await dataService.patchStudentWrapUp(studentId, wrappedUp)
    get().patchLocalStudent(studentId, { wrappedUpAt })
  },

  saveTiiChecks: async (studentId, checks) => {
    const saved = await dataService.patchTiiChecks(studentId, checks)
    get().patchLocalStudent(studentId, { tiiChecks: saved })
  },

  setDefenseConfirmed: async (studentId, confirmed) => {
    get().patchLocalStudent(studentId, { defenseConfirmed: confirmed })   // 乐观更新
    try {
      const saved = await dataService.patchDefenseConfirmed(studentId, confirmed)
      get().patchLocalStudent(studentId, { defenseConfirmed: saved })
    } catch (e) {
      get().patchLocalStudent(studentId, { defenseConfirmed: !confirmed })
      throw e
    }
  },
}))
