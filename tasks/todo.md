# Todo: Gantt Chart Feature

## Phase 1 — Backend
- [ ] Task 1: Add `GanttProject` model to `models.py`
- [ ] Task 2: Create `routers/gantt.py` with CRUD endpoints
- [ ] Task 3: Register gantt router in `main.py`
- [ ] **Checkpoint A:** Deploy backend, verify API with curl

## Phase 2 — Gantt Editor
- [ ] Task 4: Copy + modify `gantt-pro.html` → `public/gantt-editor/index.html`
- [ ] **Checkpoint B:** Open `/gantt-editor/`, create task, reload, task persists

## Phase 3 — Dashboard
- [ ] Task 5: Add gantt API methods + types to `dataService.ts` / `types/index.ts`
- [ ] Task 6: Create `GanttView.tsx` (read-only 14-day strip)
- [ ] Task 7: Replace `'list'` view with `'gantt'` in `DashboardPage.tsx`
- [ ] Task 8: Add edit entry points (student detail + sidebar)
- [ ] **Final checkpoint:** Deploy, verify end-to-end
