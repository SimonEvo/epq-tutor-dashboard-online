import os
import tempfile
from pathlib import Path

# 必须在导入 app 之前设好 —— app.database 在 import 期就建 engine，
# app.auth 在 import 期就读 SECRET_KEY。
_TMP = Path(tempfile.mkdtemp(prefix="epq-test-"))
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP / 'test.db'}"
os.environ["SECRET_KEY"] = "test-secret"
os.environ["BACKUP_DIR"] = str(_TMP / "backup")
os.environ.pop("WECOM_WEBHOOK_URL", None)   # 测试绝不能真发推送
