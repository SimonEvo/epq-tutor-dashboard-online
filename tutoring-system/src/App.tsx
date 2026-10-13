import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'
import NewStudentPage from '@/pages/NewStudentPage'
import ImportStudentsPage from '@/pages/ImportStudentsPage'
import HrSyncPage from '@/pages/HrSyncPage'
import AdminPage from '@/pages/AdminPage'
import StudentDetailPage from '@/pages/StudentDetailPage'
import EditStudentPage from '@/pages/EditStudentPage'
import NewSessionPage from '@/pages/NewSessionPage'
import EditSessionPage from '@/pages/EditSessionPage'
import SessionReportPage from '@/pages/SessionReportPage'
import ProgressReportPage from '@/pages/ProgressReportPage'
import TrialsPage from '@/pages/TrialsPage'
import TrialDetailPage from '@/pages/TrialDetailPage'
import SupervisorsPage from '@/pages/SupervisorsPage'
import SupervisorDetailPage from '@/pages/SupervisorDetailPage'
import SettingsPage from '@/pages/SettingsPage'
import ZoomConfigPage from '@/pages/ZoomConfigPage'
import WorkflowAnalysisPage from '@/pages/WorkflowAnalysisPage'
import MonthlyMeetingPage from '@/pages/MonthlyMeetingPage'
import AppLayout from '@/components/layout/AppLayout'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore()
  const checkAuth = useAuthStore(s => s.checkAuth)
  // 已登录会话的角色只在登录那一刻写进缓存；这里向服务端确认一次，
  // 这样管理员权限被撤销后不用等重新登录才生效。
  useEffect(() => { if (isAuthenticated) void checkAuth() }, [isAuthenticated, checkAuth])
  if (isLoading) return <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">Loading…</div>
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

/** 非管理员直接弹回首页。真正的闸门在后端 require_admin，这里只是不给入口。 */
function AdminOnly({ children }: { children: React.ReactNode }) {
  const role = useAuthStore(s => s.role)
  if (role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="/students/new" element={<NewStudentPage />} />
          <Route path="/students/import" element={<ImportStudentsPage />} />
          <Route path="/students/hr-sync" element={<HrSyncPage />} />
          <Route path="/students/:id" element={<StudentDetailPage />} />
          <Route path="/students/:id/edit" element={<EditStudentPage />} />
          <Route path="/students/:id/session/new" element={<NewSessionPage />} />
          <Route path="/students/:id/session/:sessionId/edit" element={<EditSessionPage />} />
          <Route path="/students/:id/session/:sessionId/report" element={<SessionReportPage />} />
          <Route path="/students/:id/report" element={<ProgressReportPage />} />
          <Route path="/trials" element={<TrialsPage />} />
          <Route path="/trials/:id" element={<TrialDetailPage />} />
          <Route path="/supervisors" element={<SupervisorsPage />} />
          <Route path="/supervisors/:id" element={<SupervisorDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/admin" element={<AdminOnly><AdminPage /></AdminOnly>} />
          <Route path="/zoom-config" element={<ZoomConfigPage />} />
          <Route path="/workflow-analysis" element={<WorkflowAnalysisPage />} />
          <Route path="/monthly-meeting" element={<MonthlyMeetingPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
