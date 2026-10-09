"""轮次解析与一年期推导。"""
import pytest

from app import rounds


@pytest.mark.parametrize("label,expected", [
    ("25秋", (2025, "autumn")),
    ("26春", (2026, "spring")),
    ("2025秋", (2025, "autumn")),
    # 教务系统导出的长格式也要能吃
    ("25秋季（26年3月提交）", (2025, "autumn")),
    ("26春季（26年9月提交）", (2026, "spring")),
    ("", None),
    (None, None),
    ("乱写", None),
])
def test_parse_round(label, expected):
    assert rounds.parse_round(label) == expected


@pytest.mark.parametrize("label,expected", [
    ("25秋", "26春"),     # 秋 → 次年春
    ("26春", "26秋"),     # 春 → 同年秋
    ("乱写", None),
])
def test_next_round(label, expected):
    assert rounds.next_round(label) == expected


def test_normalize_keeps_unrecognized_input():
    """识别不了就原样返回，不能把用户填的东西吞掉。"""
    assert rounds.normalize_round("25秋季（26年3月提交）") == "25秋"
    assert rounds.normalize_round("自定义批次") == "自定义批次"


@pytest.mark.parametrize("reg,one_year,expected", [
    ("25秋", False, "25秋"),
    ("25秋", True, "26春"),
    ("26春", True, "26秋"),
    (None, True, None),
])
def test_derive_submission_round(reg, one_year, expected):
    assert rounds.derive_submission_round(reg, one_year) == expected


@pytest.mark.parametrize("texts,expected", [
    (("张三（一年期）", None), True),
    (("李四", "25秋一年期"), True),
    (("王五(一年期)", None), True),
    (("赵六", "26春"), False),
])
def test_looks_one_year(texts, expected):
    assert rounds.looks_one_year(*texts) is expected


def test_strip_one_year_marker():
    assert rounds.strip_one_year_marker("张三（一年期）") == "张三"
    assert rounds.strip_one_year_marker("李四(一年期)") == "李四"
    assert rounds.strip_one_year_marker("王五") == "王五"


def test_one_year_base_round_beats_naive_increment():
    """教务 commit d15079a 踩过的坑：班期前缀比「报名轮次 +1」准。

    报名轮次填 26春，但班期写明这是 25秋 的一年期班 ——
    提交轮次应当是 26春（25秋 的下一轮），而不是 26秋（26春 +1）。
    """
    name, reg, sub, one_year = rounds.resolve_import_rounds(
        name="张三（一年期）", registration_round="26春", class_batch="25秋一年期",
    )
    assert (name, reg, sub, one_year) == ("张三", "25秋", "26春", True)


def test_falls_back_to_increment_without_prefix():
    name, reg, sub, one_year = rounds.resolve_import_rounds(
        name="李四（一年期）", registration_round="25秋", class_batch=None,
    )
    assert (name, reg, sub, one_year) == ("李四", "25秋", "26春", True)


def test_normal_student_rounds_are_identical():
    name, reg, sub, one_year = rounds.resolve_import_rounds(
        name="王五", registration_round="26春", class_batch="26春A班",
    )
    assert (name, reg, sub, one_year) == ("王五", "26春", "26春", False)
