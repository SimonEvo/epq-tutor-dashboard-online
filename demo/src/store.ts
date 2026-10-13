import { useCallback, useEffect, useState } from 'react'
import type { Student } from './types'
import { INITIAL_STUDENTS } from './data'

const KEY = 'epq-demo-students-v1'

function load(): Student[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as Student[]
  } catch {
    /* ignore */
  }
  return INITIAL_STUDENTS
}

export function useStudents() {
  const [students, setStudents] = useState<Student[]>(load)

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(students))
  }, [students])

  const update = useCallback((id: string, fn: (s: Student) => Student) => {
    setStudents((prev) => prev.map((s) => (s.id === id ? fn(s) : s)))
  }, [])

  const reset = useCallback(() => {
    localStorage.removeItem(KEY)
    setStudents(INITIAL_STUDENTS)
  }, [])

  return { students, update, reset }
}

export interface FeedbackItem {
  id: string
  page: string
  category: string
  content: string
  createdAt: string
}

const FB_KEY = 'epq-demo-feedback-v1'

export function loadFeedback(): FeedbackItem[] {
  try {
    const raw = localStorage.getItem(FB_KEY)
    if (raw) return JSON.parse(raw) as FeedbackItem[]
  } catch {
    /* ignore */
  }
  return []
}

export function saveFeedback(items: FeedbackItem[]) {
  localStorage.setItem(FB_KEY, JSON.stringify(items))
}
