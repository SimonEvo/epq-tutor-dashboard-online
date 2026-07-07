"""AI Name Encoding — server-side port of the client logic in
`tutoring-system/src/lib/claudeService.ts` (generateAiAlias / buildNameMappings /
encodeNames / decodeNames).

Real student names are replaced with fixed aliases before any data is sent to
the AI provider, and decoded back before display. Behaviour MUST stay identical
to the TypeScript version — see test_name_encoding.py for the golden cases.

Encoding rules (mirrored from TS):
  - Full names first, longest realName first (avoid partial collision).
  - Then given names: realName[1:] -> alias[1:], only when both len >= 2
    (single-char surname is never encoded, to avoid false positives).
Decoding reverses both, longest alias first.
"""
import random
from dataclasses import dataclass


ALIAS_POOL = [
    '王坤鹏', '李明辉', '张建国', '刘文博', '陈志远', '杨天宇', '赵海波', '黄俊豪',
    '周德旺', '吴清泉', '徐浩然', '孙立伟', '胡国庆', '朱晓松', '高伟民', '林亚男',
    '何广正', '郭文龙', '马志强', '罗宇轩', '韩泽宇', '唐建平', '冯明宇', '许志强',
    '魏俊杰', '董成功', '萧文轩', '蒋国华', '卢德明', '薛俊平', '程建辉', '谢文强',
    '傅海龙', '曹志明', '严国庆', '覃浩宇', '白文博', '田俊豪', '洪德旺', '龚清泉',
    '余志远', '秦浩然', '阮立伟', '苏国庆', '钱伟民', '钟海波', '贺文龙', '赖志强',
    '段宇轩', '邓泽宇', '邱建平', '彭俊杰', '陆成功', '葛国华', '梅德明', '雷俊平',
    '郝建辉', '贾文强', '欧海龙', '殷志明', '柏国庆', '施文博', '汤俊豪', '柴德旺',
    '易志远', '宫浩然', '步立伟', '乔国庆', '席晓松', '巩伟民', '麻海波', '卜文龙',
    '管志强', '祁宇轩', '能文博', '班俊豪', '寇德旺', '谭清泉', '鲁志远', '纪浩然',
]


@dataclass(frozen=True)
class NameMapping:
    real_name: str
    alias: str


def generate_ai_alias(existing: list[str] | None = None) -> str:
    existing = existing or []
    available = [a for a in ALIAS_POOL if a not in existing]
    pool = available if available else ALIAS_POOL
    return random.choice(pool)


def build_name_mappings(students: list) -> list[NameMapping]:
    """Build mappings from student rows/objects exposing `.name` and `.ai_alias`.

    Mirrors the TS `buildNameMappings`: only students with an alias are mapped.
    Accepts SQLAlchemy models (name / ai_alias) or any object with those attrs.
    """
    result: list[NameMapping] = []
    for s in students:
        alias = getattr(s, "ai_alias", None) or getattr(s, "aiAlias", None)
        name = getattr(s, "name", None)
        if alias and name:
            result.append(NameMapping(real_name=name.strip(), alias=alias.strip()))
    return result


def encode_names(text: str, mappings: list[NameMapping]) -> str:
    if not text:
        return text
    result = text
    # Full names first (longest realName first to avoid partial collision).
    ordered = sorted(mappings, key=lambda m: len(m.real_name), reverse=True)
    for m in ordered:
        result = result.replace(m.real_name, m.alias)
    # Then given names (realName[1:] -> alias[1:]).
    for m in ordered:
        if len(m.real_name) >= 2 and len(m.alias) >= 2:
            result = result.replace(m.real_name[1:], m.alias[1:])
    return result


def decode_names(text: str, mappings: list[NameMapping]) -> str:
    if not text:
        return text
    result = text
    ordered = sorted(mappings, key=lambda m: len(m.alias), reverse=True)
    # Full aliases first.
    for m in ordered:
        result = result.replace(m.alias, m.real_name)
    # Then given aliases.
    for m in ordered:
        if len(m.real_name) >= 2 and len(m.alias) >= 2:
            result = result.replace(m.alias[1:], m.real_name[1:])
    return result
