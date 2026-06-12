# Plan: Gantt Chart Feature

**Intent:** Internal-only visual record page showing all students' exams/holidays/deadlines on a timeline.

## Architecture Summary

- **Backend:** New `gantt_projects` table. Each tutor or student has at most one project. Data stored as JSON blob matching `gantt-pro.html`'s `{projectName, sections, tasks}` state shape.
- **Gantt Editor:** `gantt-pro.html` copied to `tutoring-system/public/gantt-editor/index.html`. Vite copies it to `dist/gantt-editor/index.html`. Nginx serves it via existing `try_files $uri/` rule — no Nginx changes needed. Auth via `localStorage('token')`.
- **Dashboard:** Replace `'list'` ViewMode with `'gantt'`. New `GanttView` React component (read-only, next 14 days, all students as rows).

## Dependency Graph

```
Task 1 (model)
  └── Task 2 (router)
        └── Task 3 (register router)
              └── [Checkpoint A: backend works]
                    ├── Task 4 (gantt editor HTML)
                    │     └── [Checkpoint B: editor end-to-end]
                    └── Task 5 (dataService.ts API methods)
                          └── Task 6 (GanttView component)
                                └── Task 7 (wire into DashboardPage)
                                      └── Task 8 (edit links)
                                            └── [Final checkpoint: deploy + verify]
```

## Tasks

### Task 1 — Backend: GanttProject model
**File:** `epq-tutor-backend/app/models.py`

Add `GanttProject` class:
- `id` String(64) PK
- `tutor_id` FK → tutors.id
- `owner_type` String(16): `'tutor'` | `'student'`
- `owner_id` String(64) nullable (null when owner_type = 'tutor')
- `name` String(128)
- `data` JSON (the full gantt state: `{projectName, sections, tasks}`)
- `created_at`, `updated_at` DateTime

UniqueConstraint on `(tutor_id, owner_type, owner_id)`.

`Base.metadata.create_all(engine)` runs on startup — table auto-created on restart.

**Verify:** Backend restarts without error.

---

### Task 2 — Backend: gantt router
**File:** `epq-tutor-backend/app/routers/gantt.py` (new)

Endpoints (all require `get_current_tutor`):
- `GET /api/gantt/projects` → list all projects for current tutor (returns id, owner_type, owner_id, name)
- `GET /api/gantt/projects/{owner_type}/{owner_id}` → get one project; returns 404 if not found
- `PUT /api/gantt/projects/{owner_type}/{owner_id}` → upsert (create or update) project data
- `DELETE /api/gantt/projects/{owner_type}/{owner_id}` → delete project

For `owner_type = 'tutor'`, `owner_id` in the URL should be the literal string `'me'` (maps to tutor.id server-side).

**Verify:** `curl -H "Authorization: Bearer <token>" http://localhost:8001/api/gantt/projects` returns `[]`.

---

### Task 3 — Backend: register router
**File:** `epq-tutor-backend/app/main.py`

Add `from app.routers import gantt` and `app.include_router(gantt.router)`.

---

### ✅ Checkpoint A: Backend
Deploy backend. Verify API endpoints respond correctly with a real JWT.

---

### Task 4 — Gantt Editor: modify gantt-pro.html
**Source:** `../gantt-chart-tool/gantt-pro.html`
**Destination:** `tutoring-system/public/gantt-editor/index.html`

Changes:
1. **Auth guard** — on page load, read `localStorage.getItem('token')`. If missing, `window.location.href = '/'`.
2. **API base** — add `const API_BASE = 'http://epq.simonevo.top'` (or detect from `window.location.origin`).
3. **Project selector** — add a `<select id="projectSelector">` in the toolbar. On load, fetch `GET /api/gantt/projects` and populate. URL param `?owner=student:STUDENT_ID` or `?owner=tutor:me` auto-selects.
4. **Replace `loadFromLS()`** → `async loadFromAPI(ownerType, ownerId)`: fetches `GET /api/gantt/projects/{ownerType}/{ownerId}`, sets `state` from response `.data`, calls `renderAll()`.
5. **Replace `scheduleSave()`** → debounced `PUT /api/gantt/projects/{ownerType}/{ownerId}` with `{name: state.projectName, data: state}`.
6. Remove `localStorage.setItem(LS_KEY, ...)` call. Keep `localStorage.getItem` fallback for migration (first load: if API returns 404 and LS has data, offer to migrate).
7. **Save status** — "✓ Saved to server" instead of "✓ Auto-saved".

**Verify:** Open `/gantt-editor/`, see project selector, add a task, see it persist after page reload.

---

### ✅ Checkpoint B: Editor end-to-end
Open `/gantt-editor/?owner=tutor:me`, create a task, reload page, task persists.

---

### Task 5 — Frontend: dataService.ts API methods
**File:** `tutoring-system/src/lib/dataService.ts`

Add:
```ts
export async function getGanttProjects(): Promise<GanttProjectSummary[]>
export async function getGanttProject(ownerType: string, ownerId: string): Promise<GanttProject | null>
export async function upsertGanttProject(ownerType: string, ownerId: string, name: string, data: object): Promise<void>
```

Add types to `tutoring-system/src/types/index.ts`:
```ts
interface GanttTask { id: string; name: string; startDate: string; endDate: string; milestone: boolean; color?: string; assignee?: string; sectionId?: string | null }
interface GanttProject { ownerType: string; ownerId: string; name: string; data: { projectName: string; sections: unknown[]; tasks: GanttTask[] } }
interface GanttProjectSummary { ownerType: string; ownerId: string; name: string }
```

**Verify:** TypeScript compiles (`npm run typecheck`).

---

### Task 6 — Frontend: GanttView component
**File:** `tutoring-system/src/components/views/GanttView.tsx` (new)

Props: `students: StudentSummary[]`

Behavior:
- On mount: fetch all gantt projects via `getGanttProjects()`, then fetch each student's project.
- Render a 14-day window (today → today+13).
- X-axis: date column headers (day abbreviation + date number), today highlighted.
- Y-axis: one row per student (name + overview label).
- Each row: render task bars and diamond markers that fall within the window.
- Bar color: from task `.color` field.
- Diamond: filled diamond SVG for milestone tasks.
- If a student has no gantt project: show empty row with "+" button linking to their gantt editor.
- Click student name → navigate to `/students/:id`.
- "编辑" button per row → `/gantt-editor/?owner=student:${id}`.
- Header "编辑所有" button → `/gantt-editor/`.

**Verify:** Renders without error when students have no gantt projects.

---

### Task 7 — Frontend: wire GanttView into DashboardPage
**File:** `tutoring-system/src/pages/DashboardPage.tsx`

- Change `'list'` → `'gantt'` in `ViewMode` type (line 16).
- Change `{ mode: 'list', label: '列表' }` → `{ mode: 'gantt', label: '甘特图' }` in `VIEW_BUTTONS` (line 21).
- Add `import GanttView from '@/components/views/GanttView'`.
- Replace `viewMode === 'list'` branch with `viewMode === 'gantt'` → `<GanttView students={filtered} />`.

**Verify:** "甘特图" tab appears in dashboard switcher, clicking it renders GanttView.

---

### Task 8 — Edit entry points
**Files:**
- `tutoring-system/src/pages/StudentDetailPage.tsx` — add "编辑时间安排" button that opens `/gantt-editor/?owner=student:${student.id}` (in new tab).
- Sidebar component — add "甘特编辑器" link to `/gantt-editor/` under 工具 section.

**Verify:** Both links open the gantt editor at the correct project.

---

### ✅ Final Checkpoint
Run `./deploy.sh`. Hard-refresh. Verify:
1. Dashboard "甘特图" view renders.
2. `/gantt-editor/` opens, project selector works.
3. Student detail page has "编辑时间安排" button.
4. Add a task in editor for a student, return to dashboard gantt view, task appears.
