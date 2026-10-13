"""教务集成接口的只读客户端（ADR 0008）。

对接 ../hr-management 的 `/api/integrations/online-form/v1`。

**刻意没有 ack 方法。**教务的 `POST /sync-acknowledgements` 把 consumer 写死成
`EPQ_ONLINE_FORMS`（在线表单系统），本系统调用它会挪动别人的同步位点。
位点存本地（system_config.hr_cursor）。别加这个方法。

session 参数可注入：生产用 requests.Session，测试传 TestClient(hr_mock)。
"""
import requests


class HrClientError(Exception):
    """教务不可达 / 鉴权失败 / 返回了看不懂的东西。消息里不带 token。"""


class HrClient:
    def __init__(self, base_url: str, token: str, session=None, timeout: float = 15.0):
        if not base_url or not token:
            raise HrClientError("教务连接尚未配置")
        self.base_url = base_url.rstrip("/")
        self._token = token
        self.session = session or requests.Session()
        self.timeout = timeout

    def _get(self, path: str, params: dict | None = None):
        try:
            resp = self.session.get(
                f"{self.base_url}{path}",
                headers={"X-Service-Token": self._token},
                params=params,
                timeout=self.timeout,
            )
        except requests.RequestException as e:
            raise HrClientError(f"连不上教务系统：{type(e).__name__}") from e
        if resp.status_code == 401:
            raise HrClientError("教务拒绝了 service token（401），请检查管理面里的配置")
        return resp

    def changes(self, after_sequence: int, limit: int = 200) -> dict:
        """变更序列的一页：{items: [{sequence, event_type, student_code, data_version}], has_more, next_cursor}"""
        resp = self._get("/project-changes", {"after_sequence": after_sequence, "limit": limit})
        if resp.status_code != 200:
            raise HrClientError(f"拉取变更序列失败（HTTP {resp.status_code}）")
        body = resp.json()
        if not isinstance(body, dict) or "items" not in body:
            raise HrClientError("变更序列格式不符")
        return body

    def project(self, student_code: str) -> dict | None:
        """单个项目详情。教务里已删除的项目返回 None。"""
        resp = self._get(f"/projects/{student_code}")
        if resp.status_code == 404:
            return None
        if resp.status_code != 200:
            raise HrClientError(f"拉取项目 {student_code} 失败（HTTP {resp.status_code}）")
        return resp.json()
