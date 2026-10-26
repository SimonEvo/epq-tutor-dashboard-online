/**
 * 「调休加班」勾选框：工作日调休期间上的课 / 试听 / 团课 / 加班事件，
 * 整场都计入加班申请，不扣工作时间窗内的部分。各表单共用，文案只写一处。
 */
interface Props {
  checked: boolean
  onChange: (checked: boolean) => void
  className?: string
}

export default function CompTimeOvertimeCheckbox({ checked, onChange, className = 'text-xs' }: Props) {
  return (
    <label className={`flex items-center gap-2 text-gray-700 cursor-pointer select-none ${className}`}>
      <input type="checkbox" checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 accent-[var(--primary)]" />
      调休加班（整场都算加班，工作时间内的部分也计入）
    </label>
  )
}
