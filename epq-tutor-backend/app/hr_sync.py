"""教务同步引擎（ADR 0008）。

  refresh_mirror()   全局：按变更序列增量拉教务项目详情，写进 hr_projects 镜像
  preview_for()      按导师：从镜像里挑出分配给他的项目，和他本地的学生逐个比对
  apply_for()        按导师：落库他勾选的那几行

落库时**不信任客户端传来的字段**——客户端只传「哪个 code、做什么动作」，
字段一律从镜像重新算。这和 Excel 导入不同（那边数据本来就来自客户端的文件）。
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app import ai_config, models, rounds, submission
from app.action_logger import log_action
from app.hr_client import HrClient
from app.scoping import scoped

# system_config 键
KEY_BASE_URL = "hr_base_url"
KEY_TOKEN = "hr_token"
KEY_CURSOR = "hr_cursor"
KEY_LAST_REFRESH = "hr_last_refresh_at"

# 只认这两种分配（ADR 0008 决策 4）。教务接口把 TA 叫 MENTOR。
SYNC_ROLES = {"SA", "MENTOR"}
ROLE_LABEL = {"SA": "SA", "MENTOR": "TA"}

# 真实账号 id 的上界。>= 这个数的是教务合成的 id（英方 SA / 按名兜底），不是稳定身份
REAL_USER_ID_LIMIT = 1_000_000

# 导师触发的刷新冷却。每次拉变更序列都会让教务扫全表、写变更行（ADR 0008 Context 4）
REFRESH_COOLDOWN = timedelta(minutes=10)

# 字段归属（ADR 0008 决策 6）
AUTHORITATIVE = ("name", "submission_round")        # 教务说了算：覆盖
FILL_ONLY = ("topic", "contact")                    # 导师说了算：只在本地为空时填
FIELD_LABEL = {"name": "姓名", "submission_round": "提交轮次", "topic": "课题",
               "contact": "联系方式", "is_one_year": "一年期"}


# ── 配置 ─────────────────────────────────────────────────────────────────────

def config_view(db: Session) -> dict:
    """给管理面看的。token 只回遮罩，和 AI key 同一套做法。"""
    token = ai_config.get(db, KEY_TOKEN)
    last = ai_config.get(db, KEY_LAST_REFRESH)
    return {
        "configured": bool(ai_config.get(db, KEY_BASE_URL) and token),
        "baseUrl": ai_config.get(db, KEY_BASE_URL),
        "tokenHint": ai_config.key_hint(token),
        "cursor": int(ai_config.get(db, KEY_CURSOR) or 0),
        "lastRefreshAt": last,
        "mirrorCount": db.query(models.HrProject).count(),
    }


def client_from_config(db: Session, session=None) -> HrClient:
    return HrClient(ai_config.get(db, KEY_BASE_URL), ai_config.get(db, KEY_TOKEN), session=session)


# ── 镜像刷新（全局） ─────────────────────────────────────────────────────────

def _cooling_down(db: Session) -> bool:
    raw = ai_config.get(db, KEY_LAST_REFRESH)
    if not raw:
        return False
    try:
        last = datetime.fromisoformat(raw)
    except ValueError:
        return False
    return datetime.now(timezone.utc) - last < REFRESH_COOLDOWN


def refresh_mirror(db: Session, client: HrClient, *, force: bool = False) -> dict:
    """按变更序列把教务项目详情增量拉进镜像。

    位点**只在全部成功后**前移：中途失败的话，下次从旧位点重读——已经写进镜像
    的项目会因版本号没变被跳过，所以重跑是安全的。
    """
    if not force and _cooling_down(db):
        return {"skipped": True, "reason": "cooldown", **_counts(db)}

    cursor = int(ai_config.get(db, KEY_CURSOR) or 0)
    latest: dict[str, int] = {}
    while True:
        page = client.changes(cursor)
        for item in page["items"]:
            code = item["student_code"]
            latest[code] = max(latest.get(code, 0), int(item["data_version"]))
        if page.get("next_cursor"):
            cursor = int(page["next_cursor"])
        if not page.get("has_more"):
            break

    fetched = removed = 0
    for code, version in latest.items():
        row = db.get(models.HrProject, code)
        if row is not None and row.data_version >= version:
            continue                                   # 镜像已是最新
        detail = client.project(code)
        if detail is None:                             # 教务里已删除
            if row is not None:
                db.delete(row)
                removed += 1
            continue
        if row is None:
            row = models.HrProject(student_code=code)
            db.add(row)
        row.hr_project_id = detail.get("id")
        row.data_version = int(detail.get("data_version") or version)
        row.payload = detail
        fetched += 1
        db.flush()

    ai_config.put(db, KEY_CURSOR, str(cursor))
    ai_config.put(db, KEY_LAST_REFRESH, datetime.now(timezone.utc).isoformat())
    db.commit()
    return {"skipped": False, "fetched": fetched, "removed": removed, **_counts(db)}


def _counts(db: Session) -> dict:
    return {"cursor": int(ai_config.get(db, KEY_CURSOR) or 0),
            "mirrorCount": db.query(models.HrProject).count()}


# ── 教务里的人（给管理员做关联用） ───────────────────────────────────────────

def linkable_people(db: Session) -> list[dict]:
    """镜像里出现过的、可以关联的教务老师：真实账号、SA/MENTOR 角色。

    合成 id（英方 SA、按名兜底）不在列——它们不是稳定身份（ADR 0008 决策 3）。
    """
    people: dict[int, dict] = {}
    for p in db.query(models.HrProject).all():
        for a in (p.payload or {}).get("assignments", []):
            uid = a.get("id")
            if not isinstance(uid, int) or uid >= REAL_USER_ID_LIMIT or a.get("role") not in SYNC_ROLES:
                continue
            person = people.setdefault(uid, {"hrUserId": uid, "name": a.get("name") or "",
                                             "email": a.get("email") or "", "projectCount": 0})
            person["projectCount"] += 1
    linked = {t.hr_user_id: t for t in db.query(models.Tutor).filter(models.Tutor.hr_user_id.isnot(None))}
    for uid, person in people.items():
        t = linked.get(uid)
        person["linkedTutorId"] = t.id if t else None
        person["linkedTutorName"] = (t.display_name or t.username) if t else None
    return sorted(people.values(), key=lambda x: x["name"])


# ── 字段映射 ─────────────────────────────────────────────────────────────────

def _mirror_to_student_fields(payload: dict) -> dict:
    """教务详情 → 本系统学生字段。教务接口只给这么多（ADR 0008 Context 1）。

    将来教务若扩接口（学校、年级……），这里是唯一改动点。
    """
    student = payload.get("student") or {}
    raw_name = (student.get("name") or "").strip()
    term = payload.get("academic_term") or {}
    return {
        "name": rounds.strip_one_year_marker(raw_name),
        "submission_round": rounds.normalize_round(term.get("name")) if term.get("name") else None,
        "topic": (payload.get("title") or "").strip() or None,
        "contact": (student.get("email") or "").strip() or None,
        "is_one_year": rounds.looks_one_year(raw_name),
    }


def _my_role(payload: dict, hr_user_id: int) -> str | None:
    for a in payload.get("assignments", []):
        if a.get("id") == hr_user_id and a.get("role") in SYNC_ROLES and a.get("is_active", True):
            return a["role"]
    return None


def my_projects(db: Session, tutor: models.Tutor) -> dict[str, tuple[models.HrProject, str]]:
    """{student_code: (镜像行, 角色)}——教务里分配给这位导师的项目。"""
    if not tutor.hr_user_id:
        return {}
    out = {}
    for p in db.query(models.HrProject).all():
        role = _my_role(p.payload or {}, tutor.hr_user_id)
        if role:
            out[p.student_code] = (p, role)
    return out


def _diffs(student: models.Student | None, fields: dict) -> list[dict]:
    """按字段归属规则算出「会改什么」。student 为 None 表示新建。"""
    out = []

    def add(key, before, after):
        out.append({"field": key, "label": FIELD_LABEL[key],
                    "before": "" if before is None else str(before),
                    "after": "" if after is None else str(after)})

    for key in AUTHORITATIVE:
        new = fields.get(key)
        if new is None:
            continue
        old = getattr(student, key) if student else None
        if (old or None) != new:
            add(key, old, new)
    for key in FILL_ONLY:
        new = fields.get(key)
        old = getattr(student, key) if student else None
        if new and not (old or "").strip():
            add(key, old, new)
    if fields.get("is_one_year") and not (student and student.is_one_year):
        add("is_one_year", "否" if student else "", "是")
    return out


def _norm_name(v: str | None) -> str:
    return "".join((rounds.strip_one_year_marker(v) or "").split()).lower()


# ── 预览（按导师） ───────────────────────────────────────────────────────────

def preview_for(db: Session, tutor: models.Tutor) -> dict:
    mine = my_projects(db, tutor)
    students = scoped(db, models.Student, tutor).all()
    by_code = {s.hr_student_code: s for s in students if s.hr_student_code}
    unlinked_by_name: dict[str, list[models.Student]] = {}
    for s in students:
        if not s.hr_student_code:
            unlinked_by_name.setdefault(_norm_name(s.name), []).append(s)

    rows = []
    for code, (proj, role) in sorted(mine.items()):
        payload = proj.payload or {}
        fields = _mirror_to_student_fields(payload)
        row = {"code": code, "name": fields["name"], "role": ROLE_LABEL[role],
               "exited": bool(payload.get("is_exit")), "reason": "",
               "matchedStudentId": None, "matchedStudentName": None, "diffs": []}

        local = by_code.get(code)
        if local:
            row.update(category="update", matchedStudentId=local.id,
                       matchedStudentName=local.name, diffs=_diffs(local, fields))
        else:
            candidates = unlinked_by_name.get(_norm_name(fields["name"]), [])
            if len(candidates) == 1:
                c = candidates[0]
                row.update(category="link", matchedStudentId=c.id, matchedStudentName=c.name,
                           diffs=_diffs(c, fields),
                           reason=f"本地已有同名学生「{c.name}」，关联后此后按教务编号匹配")
            elif len(candidates) > 1:
                row.update(category="conflict",
                           reason=f"本地有 {len(candidates)} 名同名学生，无法确定关联哪一个")
            else:
                row.update(category="new", diffs=_diffs(None, fields))
        rows.append(row)

    # 本地关联过、但教务里已不再分配给你的 —— 只提示，不动
    orphans = [{"studentId": s.id, "name": s.name, "code": s.hr_student_code}
               for s in students if s.hr_student_code and s.hr_student_code not in mine]

    return {
        "linked": bool(tutor.hr_user_id),
        "rows": rows,
        "orphans": orphans,
        "summary": {k: sum(1 for r in rows if r["category"] == k)
                    for k in ("new", "update", "link", "conflict")},
    }


# ── 落库（按导师） ───────────────────────────────────────────────────────────

def apply_for(db: Session, tutor: models.Tutor, decisions: list[dict]) -> dict:
    """decisions: [{code, action: create|update|link|skip, studentId?}]

    字段从镜像重算，不用客户端的。code 必须在这位导师的分配里——
    否则就是在把一个不归你的学生拉进你的空间。
    """
    import uuid

    mine = my_projects(db, tutor)
    done = {"created": 0, "updated": 0, "linked": 0, "skipped": 0}

    for d in decisions:
        action, code = d.get("action"), d.get("code")
        if action == "skip":
            done["skipped"] += 1
            continue
        if code not in mine:
            raise PermissionError(f"教务项目 {code} 没有分配给你")
        fields = _mirror_to_student_fields(mine[code][0].payload or {})

        if action == "create":
            if scoped(db, models.Student, tutor).filter(models.Student.hr_student_code == code).first():
                raise ValueError(f"{code} 已经关联过本地学生，不能重复新建")
            student = models.Student(id=str(uuid.uuid4()), tutor_id=tutor.id,
                                     hr_student_code=code, name=fields["name"], topic="")
            db.add(student)
            done["created"] += 1
        elif action in ("update", "link"):
            student = scoped(db, models.Student, tutor).filter(
                models.Student.id == d.get("studentId")).first()
            if student is None:
                raise LookupError("要更新的学生不存在")
            if action == "update" and student.hr_student_code != code:
                raise ValueError("该学生没有关联这个教务编号")
            if action == "link":
                if student.hr_student_code:
                    raise ValueError(f"「{student.name}」已关联了别的教务编号")
                student.hr_student_code = code
                done["linked"] += 1
            else:
                done["updated"] += 1
        else:
            raise ValueError(f"未知操作 {action}")

        for diff in _diffs(student if action != "create" else None, fields):
            key = diff["field"]
            if key == "is_one_year":
                student.is_one_year = True
            elif key == "submission_round":
                submission.set_submission_round(student, fields[key])   # 清旧截止安排
            else:
                setattr(student, key, fields[key])
        log_action(db, tutor, action, "student", student.id, {"via": "hr_sync", "code": code})

    db.commit()
    return done
