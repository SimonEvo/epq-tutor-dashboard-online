"""轮次（学期）解析与推导。

本系统的轮次标签是短格式：`25秋` / `26春`，含义见 CONTEXT.md：
  - `XX春` 春季批次：约 2 月开课，当年 8 月提交
  - `XX秋` 秋季批次：约 9 月开课，次年 3 月提交
两者都**以开课学期命名**。

## 报名轮次 vs 提交轮次

原先只有一个 `submissionRound`，既当签约批次又当提交批次用。普通学生两者相同，
但有两种情况会分叉：

  1. **一年期学生** —— 学制跨两个批次，提交落在报名批次的下一轮。
  2. **延期** —— 学生推迟到下一轮提交（CONTEXT.md「Deferral to the next round」）。
     原先做法是直接改 `submissionRound`，改完就再也看不出他本来属于哪一批。

拆成 `registrationRound`（签约批次，不变）+ `submissionRound`（提交批次，可变）
之后两种情况都能表达，且延期学生保留原始批次。

## 与教务系统的关系

对应 `../hr-management` 的 `registration_term` / `intake_term`（见
backend/app/services/academic_term.py）。推导规则照搬，标签格式不照搬 ——
教务用 `25秋季（26年3月提交）` 长格式，这边保持 `25秋`，避免翻搅存量 rounds
数据和 ADR 0003 的截止时间模型。

下面的解析正则对两种格式都成立，所以从教务导出的表可以直接导入，自动归一为短格式。

**注意一处不一致：** 教务的 `term_values()` 认为春季批次 9 月提交，本系统
CONTEXT.md 写的是 8 月。`submission_hint()` 按本系统的说法实现。真要对接时
需要先确认哪个对。
"""
import re

SEASON_SPRING = "spring"
SEASON_AUTUMN = "autumn"

# 兼容两种写法：`25秋` / `2025秋季` / `25秋季（26年3月提交）`（教务导出格式）
_ROUND_RE = re.compile(r"(?<!\d)(\d{2}|\d{4})\s*年?\s*(春|秋)")

# 一年期标记：全角半角括号都认，也认不带括号的 `25秋一年期`
_ONE_YEAR_RE = re.compile(r"[（(]?\s*一年期\s*[)）]?")
_ONE_YEAR_BASE_RE = re.compile(r"(?<!\d)(\d{2}|\d{4})\s*年?\s*(春|秋)\s*季?\s*[（(]?\s*一年期")


def parse_round(label: str | None) -> tuple[int, str] | None:
    """`25秋` → (2025, 'autumn')。解析不出返回 None。"""
    if not label:
        return None
    m = _ROUND_RE.search(label.strip())
    if not m:
        return None
    raw = int(m.group(1))
    year = 2000 + raw if raw < 100 else raw
    if not (2000 <= year <= 2100):
        return None
    return year, (SEASON_SPRING if m.group(2) == "春" else SEASON_AUTUMN)


def format_round(year: int, season: str) -> str:
    """(2025, 'autumn') → `25秋`"""
    return f"{year % 100:02d}{'春' if season == SEASON_SPRING else '秋'}"


def next_round(label: str | None) -> str | None:
    """下一轮：春 → 同年秋；秋 → 次年春。解析不出返回 None。"""
    parsed = parse_round(label)
    if not parsed:
        return None
    year, season = parsed
    if season == SEASON_SPRING:
        return format_round(year, SEASON_AUTUMN)
    return format_round(year + 1, SEASON_SPRING)


def normalize_round(label: str | None) -> str | None:
    """把任意可识别写法归一为短格式；识别不了则原样返回（不丢用户输入）。"""
    parsed = parse_round(label)
    return format_round(*parsed) if parsed else (label or None)


def derive_submission_round(
    registration_round: str | None, is_one_year: bool
) -> str | None:
    """由报名轮次推提交轮次。一年期顺延一轮，其余相同。

    这是**建议值**，不是强制值：延期学生的 submissionRound 由人工改动，
    调用方（导入、编辑表单）负责决定要不要采纳。
    """
    reg = normalize_round(registration_round)
    if not reg:
        return None
    return next_round(reg) if is_one_year else reg


def submission_hint(label: str | None) -> str:
    """`25秋` → `26年3月提交`，给界面做提示文案用。识别不了返回空串。"""
    parsed = parse_round(label)
    if not parsed:
        return ""
    year, season = parsed
    if season == SEASON_SPRING:
        return f"{year % 100:02d}年8月提交"
    return f"{(year + 1) % 100:02d}年3月提交"


# ── 导入边界专用：从教务表格的自由文本里嗅探一年期 ──────────────────────────
# 领域模型里一年期是 students.is_one_year 布尔字段，不靠字符串判断。
# 只有在导入时才需要这些 —— 教务导出的表把标记塞在姓名或班期里。

def looks_one_year(*texts: str | None) -> bool:
    """姓名或班期里带「一年期」标记（全角半角括号皆可）。"""
    return any(t and _ONE_YEAR_RE.search(t) for t in texts)


def strip_one_year_marker(name: str | None) -> str:
    """把姓名里的「（一年期）」去掉 —— 它是批次信息，不是名字的一部分。"""
    if not name:
        return ""
    return _ONE_YEAR_RE.sub("", name).strip()


def one_year_base_round(*texts: str | None) -> str | None:
    """从 `25秋一年期` 这类前缀里取一年期项目的起始轮次。

    教务那边踩过的坑（commit d15079a）：最初只会拿报名学期「无脑 +1」，
    但班期字段本身常常带着起始学期前缀，那个前缀才是准的。优先用它。
    """
    for t in texts:
        if not t:
            continue
        m = _ONE_YEAR_BASE_RE.search(t)
        if m:
            raw = int(m.group(1))
            year = 2000 + raw if raw < 100 else raw
            return format_round(year, SEASON_SPRING if m.group(2) == "春" else SEASON_AUTUMN)
    return None


def resolve_import_rounds(
    *, name: str | None, registration_round: str | None, class_batch: str | None = None
) -> tuple[str, str | None, str | None, bool]:
    """导入一行时把姓名/报名轮次/班期解析成 (姓名, 报名轮次, 提交轮次, 是否一年期)。

    顺序和教务一致：先看有没有一年期标记；有的话优先用班期/姓名里的起始轮次前缀，
    取不到才退回「报名轮次 +1」。
    """
    one_year = looks_one_year(name, class_batch)
    clean_name = strip_one_year_marker(name)
    reg = normalize_round(registration_round)

    if not one_year:
        return clean_name, reg, reg, False

    base = one_year_base_round(class_batch, name)
    if base:
        return clean_name, base, next_round(base), True
    return clean_name, reg, derive_submission_round(reg, True), True
