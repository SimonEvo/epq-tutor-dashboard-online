import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'
import NewStudentPage from '@/pages/NewStudentPage'
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
  if (isLoading) return <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">Loading…</div>
  if (!isAuthenticated) return <Navigate to="/login" replace />
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
          <Route path="/zoom-config" element={<ZoomConfigPage />} />
          <Route path="/workflow-analysis" element={<WorkflowAnalysisPage />} />
          <Route path="/monthly-meeting" element={<MonthlyMeetingPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}
