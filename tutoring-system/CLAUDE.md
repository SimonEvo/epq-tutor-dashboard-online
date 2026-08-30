# CLAUDE.md — tutoring-system（前端）

**项目总说明看仓库根目录的 `CLAUDE.md`**（架构、后端、部署、服务器、当前进度都在那儿）。
这份只记前端目录内部的事。

> 历史提醒：这个前端曾经是「GitHub Pages 静态站 + Octokit 直连 GitHub 仓库存 JSON」，
> 现在早就换成 FastAPI + SQLite 后端了。如果在别处看到 PAT / Octokit / `epq-tutor-data`
> 仓库之类的说法，那是过时信息，以根目录 `CLAUDE.md` 为准。
> （`package.json` 里的 `@octokit/rest` 已经没有任何代码引用，属于待清理的残留。）

## 命令
```bash
npm run dev        # localhost:5173，已配 proxy 到 8001，需后端在跑
npm run typecheck  # tsc -b --noEmit
npm run lint       # eslint .
npm run build      # tsc -b && vite build
```
部署统一走仓库根目录的 `python deploy.py`，别单独用 `npm run deploy`。

## 目录
```
src/
├── pages/        # 路由页面（DashboardPage 最大，加班/课时统计等弹窗也在里面）
├── components/   # 复用组件；views/ 下是 Dashboard 的各视图（日程 / 甘特图 / 提交 / 概览…）
├── lib/          # dataService（所有 API 调用的唯一出口）、githubClient（apiFetch + JWT）、各类纯逻辑
├── stores/       # Zustand
├── types/        # 全局 TS 类型，后端 schema 的镜像
└── config.ts     # JWT_STORAGE_KEY 等常量
```

## 约定
- **所有后端调用只经过 `lib/dataService.ts`**，组件里不直接 `fetch`
- `apiFetch`（`lib/githubClient.ts`）自动带 JWT（存 localStorage，key 见 `config.ts`）
- `privateNotes` 不得出现在任何导出输出里
- JWT 不得 log、不得出现在错误信息中

## 配色的坑
课程类型的颜色在三处各有一份，**且不完全一致，是刻意的**：
- `lib/ganttColors.ts` —— 甘特图 + 导出 PDF 共用。英方SA 是 salmon，不弱化（要衬托课后反馈状态环）
- `components/views/WeekScheduleView.tsx` —— 英方SA 平时是灰的（你不用出席），勾「导师出席」才变 salmon
- `pages/DashboardPage.tsx` 的 `OT_*` —— 加班申请弹窗的色块

别为了「统一」把它们合成一份。图例组件 `components/views/ScheduleLegend.tsx` 是共用的，条目各视图自己传。
