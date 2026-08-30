/**
 * 日程 / 甘特图共用的颜色图例。两个视图画的东西不一样（甘特图没有试听、
 * 个人事件、加班块；日历会把不用出席的英方SA 弱化成灰），所以各自传各自的
 * 条目，这里只负责画。双色块用于「答辩」这类中英方共用一个名字、颜色不同的项。
 */

export interface LegendItem {
  label: string
  color: string
  /** 传了就画成对角双色块（左上 color / 右下 color2） */
  color2?: string
  title?: string
}

export default function ScheduleLegend({ items }: { items: LegendItem[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
      {items.map(it => (
        <span key={it.label} className="flex items-center gap-1" title={it.title}>
          <i
            className="w-2.5 h-2.5 rounded-sm shrink-0"
            style={{
              background: it.color2
                ? `linear-gradient(135deg, ${it.color} 0 50%, ${it.color2} 50% 100%)`
                : it.color,
            }}
          />
          {it.label}
        </span>
      ))}
    </div>
  )
}
