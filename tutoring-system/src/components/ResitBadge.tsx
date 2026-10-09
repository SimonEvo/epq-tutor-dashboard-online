/** 学生正在 resit（二次提交）的小标记 */
export default function ResitBadge({ className = '' }: { className?: string }) {
  return (
    <span
      title="Resit：第一次提交已完成，正在二次提交"
      className={`inline-block align-middle text-[10px] leading-4 px-1.5 rounded bg-purple-50 text-purple-600 font-medium ${className}`}
    >
      Resit
    </span>
  )
}
