import { Link } from 'react-router-dom'

/**
 * 新账号的首屏引导。
 *
 * 内测老师登录后看到的是一个空 Dashboard，没有任何线索该从哪开始。
 * 这里给三条路 + 一条隐私说明 —— 后者是内测须知里最要紧的一句：
 * 管理员看不到你的学生数据（ADR 0004 决策 5 把它写成了硬约束）。
 */
export default function FirstRunGuide() {
  return (
    <div className="py-10 max-w-2xl mx-auto">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">欢迎使用 EPQ 辅导面板</h2>
      <p className="text-sm text-gray-500 mb-6">
        这里还没有学生。挑一种方式开始 —— 两种都可以，后面随时能改。
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <Link
          to="/students/import"
          className="block rounded-2xl border border-[var(--border)] bg-white p-4 hover:border-gray-300 transition-colors"
        >
          <div className="text-sm font-medium text-gray-900 mb-1">从 Excel 导入</div>
          <p className="text-xs text-gray-500">
            有现成的学生名单就走这条。表头自动识别，列顺序无所谓，导入前会逐行让你确认。
          </p>
        </Link>
        <Link
          to="/students/new"
          className="block rounded-2xl border border-[var(--border)] bg-white p-4 hover:border-gray-300 transition-colors"
        >
          <div className="text-sm font-medium text-gray-900 mb-1">手动新建一名学生</div>
          <p className="text-xs text-gray-500">
            先加一个试试。建完就能记课时、追里程碑、生成 AI 报告。
          </p>
        </Link>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
        <div className="text-sm font-medium text-gray-900 mb-2">关于你的数据</div>
        <ul className="text-xs text-gray-600 space-y-1.5 list-disc list-inside">
          <li>
            你的学生、课程纪要和私密笔记<span className="text-gray-900">只有你能看到</span>。
            管理员能管理账号，但看不到任何人的学生数据，系统也不提供「以某人身份登录」。
          </li>
          <li>AI 凭据由机构统一提供，你不需要自己申请。调用次数会被统计（只观测，不限额）。</li>
          <li>提交轮次和截止时间由管理员统一维护，所有老师共用同一套。</li>
          <li>数据每天自动备份，也可以在<Link to="/settings" className="underline">设置</Link>里自己导出一份。</li>
        </ul>
      </div>
    </div>
  )
}
