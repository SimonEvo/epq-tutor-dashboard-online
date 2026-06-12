# ADR 0001: Gantt Editor Served as Standalone HTML, Not Rewritten as React

**Status:** Accepted  
**Date:** 2026-06-05

## Context

The tutor has a working Gantt chart tool (`gantt-pro.html`, ~2000 lines of vanilla JS with embedded html2canvas and jsPDF). The goal is to integrate Gantt functionality into the EPQ dashboard for student timeline management.

## Decision

Serve `gantt-pro.html` as a standalone static page via Nginx. Do not rewrite it as a React component. The React dashboard handles read-only display only (Gantt View); all editing happens in the standalone page.

## Alternatives Considered

**Rewrite as React component** — Full control over styling and integration, but high effort for functionality already working. The gantt rendering alone (SVG layout, zoom levels, dependency arrows) would take significant time to reimplement correctly.

**iframe embed** — Reuses existing rendering but React ↔ iframe communication is fragile, and styling cannot be unified with Tailwind.

## Consequences

- `gantt-pro.html` must be modified to read/write data via backend API instead of localStorage, and to authenticate using the shared JWT from `localStorage('token')`.
- The React Gantt View is a separate, simpler read-only strip component — it does not share code with the editor.
- Nginx config must add a route for the gantt editor page.
