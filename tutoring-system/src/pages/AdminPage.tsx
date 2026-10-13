import { useEffect, useState } from 'react'
import {
  createTutorAccount, listHrPeople, listTutorAccounts, resetTutorPassword, updateTutorAccount,
  type HrPerson, type TutorAccount,
} from '@/lib/dataService'
import HrConnectionSection from '@/components/admin/HrConnectionSection'
import { useAuthStore } from '@/stores/authStore'

const MIN_PASSWORD_LEN = 8

function fmt(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function AdminPage() {
  const myId = useAuthStore(s => s.username)
  const [accounts, setAccounts] = useState<TutorAccount[]>([])
  const [hrPeople, setHrPeople] = useState<HrPerson[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', displayName: '' })
  const [resetting, setResetting] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      setAccounts(await listTutorAccounts())
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  // 教务老师名单来自本地镜像；教务没配好时就是空的，不算错误
  const loadHrPeople = () => { listHrPeople().then(setHrPeople).catch(() => setHrPeople([])) }

  useEffect(() => { void load(); loadHrPeople() }, [])

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setError(''); setNotice('')
    try {
      await fn()
      setNotice(ok)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    }
  }

  const create = () =>
    run(async () => {
      await createTutorAccount({
        username: form.username.trim(),
        password: form.password,
        displayName: form.displayName.trim(),
      })
      setForm({ username: '', password: '', displayName: '' })
      setShowNew(false)
    }, '账号已创建')

  const doReset = (id: string) =>
    run(async () => {
      await resetTutorPassword(id, newPassword)
      setResetting(null)
      setNewPassword('')
    }, '密码已重置，该账号的登录状态已失效')

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-2xl font-semibold text-gray-900">账号管理</h1>
        <button
          onClick={() => setShowNew(v => !v)}
          className="bg-[var(--primary)] text-white text-sm px-4 py-2 rounded-lg hover:bg-[var(--primary-hover)]"
        >
          {showNew ? '取消' : '+ 新建账号'}
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-6">
        这里只显示账号本身的信息。<span className="text-gray-700">管理员看不到其他老师的学生、纪要和笔记</span>，
        系统也不提供「以某人身份登录」。
      </p>

      <HrConnectionSection onRefreshed={loadHrPeople} />

      {showNew && (
        <div className="bg-white rounded-2xl border border-[var(--border)] p-5 mb-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">新建账号</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
              placeholder="用户名" className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
            <input
              value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })}
              placeholder="显示名（可选）" className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="text" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
              placeholder={`初始密码（至少 ${MIN_PASSWORD_LEN} 位）`}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <p className="mt-2 text-xs text-gray-500">
            密码明文显示，方便你复制给对方。新账号登录后自己改不了密码，需要时找你重置。
          </p>
          <button
            onClick={create}
            disabled={!form.username.trim() || form.password.length < MIN_PASSWORD_LEN}
            className="mt-3 bg-[var(--primary)] text-white text-sm px-4 py-2 rounded-lg
                       hover:bg-[var(--primary-hover)] disabled:opacity-40"
          >
            创建
          </button>
        </div>
      )}

      {notice && <p className="mb-3 text-sm text-green-700">{notice}</p>}
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-400">加载中…</p>
      ) : (
        <div className="bg-white rounded-2xl border border-[var(--border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left px-4 py-2 font-medium">账号</th>
                <th className="text-left px-4 py-2 font-medium">角色</th>
                <th className="text-right px-4 py-2 font-medium">学生</th>
                <th className="text-right px-4 py-2 font-medium">AI 调用</th>
                <th className="text-left px-4 py-2 font-medium">教务账号</th>
                <th className="text-left px-4 py-2 font-medium">最后登录</th>
                <th className="text-right px-4 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(a => {
                const isSelf = a.username === myId
                return (
                  <tr key={a.id} className="border-t border-gray-100">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">
                        {a.displayName || a.username}
                        {isSelf && <span className="ml-2 text-xs text-gray-400">（你）</span>}
                      </div>
                      <div className="text-xs text-gray-400">
                        {a.username} · 建于 {fmt(a.createdAt)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded border ${
                        a.role === 'admin'
                          ? 'bg-purple-50 text-purple-700 border-purple-200'
                          : 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                        {a.role === 'admin' ? '管理员' : '导师'}
                      </span>
                      {a.status === 'disabled' && (
                        <span className="ml-1 text-xs px-2 py-0.5 rounded border bg-red-50 text-red-700 border-red-200">
                          已停用
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">{a.studentCount}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{a.aiCallCount}</td>
                    <td className="px-4 py-3">
                      {/* 关联到教务里的真实账号（ADR 0008 决策 3）。已被别人占用的不可选。 */}
                      <select
                        value={a.hrUserId ?? 0}
                        disabled={hrPeople.length === 0 && !a.hrUserId}
                        onChange={e => void run(
                          () => updateTutorAccount(a.id, { hrUserId: Number(e.target.value) }),
                          Number(e.target.value) ? '已关联教务账号' : '已取消关联',
                        ).then(loadHrPeople)   // 名单里的「已关联 X」也要跟着变
                        }
                        className="border border-gray-200 rounded px-2 py-1 text-xs max-w-[11rem]"
                      >
                        <option value={0}>{hrPeople.length ? '— 未关联 —' : '先拉取教务数据'}</option>
                        {a.hrUserId && !hrPeople.some(p => p.hrUserId === a.hrUserId) && (
                          <option value={a.hrUserId}>#{a.hrUserId}（镜像里没有）</option>
                        )}
                        {hrPeople.map(p => (
                          <option key={p.hrUserId} value={p.hrUserId}
                            disabled={!!p.linkedTutorId && p.linkedTutorId !== a.id}>
                            {p.name}（{p.projectCount} 个项目）
                            {p.linkedTutorId && p.linkedTutorId !== a.id ? ` · 已关联 ${p.linkedTutorName}` : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{fmt(a.lastLoginAt)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => setResetting(resetting === a.id ? null : a.id)}
                        className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50"
                      >
                        重置密码
                      </button>
                      {!isSelf && (
                        <button
                          onClick={() => run(
                            () => updateTutorAccount(a.id, {
                              status: a.status === 'active' ? 'disabled' : 'active',
                            }),
                            a.status === 'active' ? '已停用，该账号的登录状态立即失效' : '已启用',
                          )}
                          className="ml-2 text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50"
                        >
                          {a.status === 'active' ? '停用' : '启用'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {accounts.some(a => a.id === resetting) && (
                <tr className="border-t border-gray-100 bg-gray-50">
                  <td colSpan={7} className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                        placeholder={`新密码（至少 ${MIN_PASSWORD_LEN} 位）`}
                        className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex-1 max-w-xs"
                      />
                      <button
                        onClick={() => resetting && doReset(resetting)}
                        disabled={newPassword.length < MIN_PASSWORD_LEN}
                        className="text-sm px-3 py-2 bg-[var(--primary)] text-white rounded-lg disabled:opacity-40"
                      >
                        确认重置
                      </button>
                      <span className="text-xs text-gray-500">重置后对方当前的登录会立即失效</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
