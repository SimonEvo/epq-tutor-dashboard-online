#!/usr/bin/env python3
"""Deploy frontend + backend to the ECS server. Cross-platform (macOS / Linux / Windows).

Uses ssh / scp / tar -- all present on macOS and Win10/11 -- so no rsync needed.
Replaces the old deploy.sh / deploy.ps1.

Usage:  python deploy.py [server_ip]
Requires: this machine can ssh into root@server (key auth; otherwise each step
prompts for a password).
"""
import os
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime
from pathlib import Path

SERVER = sys.argv[1] if len(sys.argv) > 1 else "121.43.194.213"
ROOT = Path(__file__).resolve().parent
NPM = "npm.cmd" if os.name == "nt" else "npm"  # npm is a .cmd shim on Windows


def run(cmd, **kw):
    print("+", " ".join(str(c) for c in cmd))
    subprocess.run(cmd, check=True, **kw)


def git(*args) -> str:
    """git 输出；仓库不可用时返回空串，不让部署失败。"""
    try:
        out = subprocess.run(
            ["git", *args], cwd=ROOT, capture_output=True, text=True, check=True
        )
        return out.stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


def build_env() -> dict:
    """给 vite build 注入部署时间 + 签名（部署人 · git 短 hash），侧边栏「系统」下显示。"""
    who = git("config", "user.name") or os.environ.get("USERNAME") or "unknown"
    commit = git("rev-parse", "--short", "HEAD")
    dirty = " *" if git("status", "--porcelain") else ""
    env = os.environ.copy()
    env["VITE_BUILD_TIME"] = datetime.now().strftime("%Y-%m-%d %H:%M")
    env["VITE_BUILD_SIG"] = f"{who} · {commit or 'no-git'}{dirty}"
    print(f"  build sig: {env['VITE_BUILD_SIG']}  @ {env['VITE_BUILD_TIME']}")
    return env


def sync_dir(local_dir: Path, remote_dir: str, exclude=(), clean=False):
    """tar the local dir (with excludes) -> scp to server -> untar into remote dir.

    clean=True wipes the remote dir first (used for the frontend dist so stale
    hashed bundles don't pile up).
    """
    name = f"epq-deploy-{uuid.uuid4().hex}.tar"
    local_tar = Path(tempfile.gettempdir()) / name
    remote_tar = f"/tmp/{name}"

    tar_cmd = ["tar", "-C", str(local_dir)]
    tar_cmd += [f"--exclude={e}" for e in exclude]
    tar_cmd += ["-cf", str(local_tar), "."]
    run(tar_cmd)

    try:
        run(["scp", str(local_tar), f"root@{SERVER}:{remote_tar}"])
    finally:
        local_tar.unlink(missing_ok=True)

    wipe = f"rm -rf {remote_dir}/*; " if clean else ""
    remote_cmd = (
        f"mkdir -p {remote_dir}; {wipe}"
        f"tar -C {remote_dir} -xf {remote_tar}; rm -f {remote_tar}"
    )
    run(["ssh", f"root@{SERVER}", remote_cmd])


def main():
    print("=== Deploying backend ===")
    sync_dir(
        ROOT / "epq-tutor-backend",
        "/opt/epq-tutor-backend",
        exclude=(".venv", "__pycache__", "*.pyc", ".env", "*.db"),
    )
    run(["ssh", f"root@{SERVER}", "systemctl restart epq-tutor; systemctl status epq-tutor --no-pager -l"])

    print("\n=== Deploying frontend ===")
    run([NPM, "run", "build"], cwd=ROOT / "tutoring-system", env=build_env())
    sync_dir(ROOT / "tutoring-system" / "dist", "/opt/epq-tutor/dist", clean=True)

    # gantt-pro lives in a sibling repo (../gantt-chart-tool), not in this one, so
    # it may be absent on some machines. Deploy it when present; otherwise skip
    # rather than fail the whole run (backend + frontend are already up by here).
    print("\n=== Deploying gantt-pro ===")
    gantt = ROOT.parent / "gantt-chart-tool" / "gantt-pro.html"
    if gantt.exists():
        run(["ssh", f"root@{SERVER}", "mkdir -p /opt/gantt-pro"])
        run(["scp", str(gantt), f"root@{SERVER}:/opt/gantt-pro/gantt-pro.html"])
    else:
        print(f"  skipped: {gantt} not found on this machine")

    print("\n=== Done ===")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        print(f"\n[deploy failed] command exited with {e.returncode}: {' '.join(str(c) for c in e.cmd)}")
        sys.exit(e.returncode)
