"""Isolated v2 loader smoke: never executes the autoport tool or uses live config."""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.request

root = Path(tempfile.mkdtemp(prefix="autoport-load-", dir=os.environ["TMPDIR"]))
config = root / "config"
config.mkdir()
(config / "opencode.json").write_text(json.dumps({"plugins": [str(Path(__file__).parent.resolve())]}))
env = {k: v for k, v in os.environ.items() if not k.startswith("OPENCODE_")}
env.update(HOME=str(root), USERPROFILE=str(root), OPENCODE_TEST_HOME=str(root),
           OPENCODE_CONFIG_DIR=str(config), OPENCODE_DB=str(root / "db.sqlite"),
           XDG_CONFIG_HOME=str(root / "xdg-config"), XDG_DATA_HOME=str(root / "data"),
           XDG_CACHE_HOME=str(root / "cache"), XDG_STATE_HOME=str(root / "state"))
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
with (root / "server.log").open("w") as log:
    server = subprocess.Popen(["opencode", "serve", "--hostname", "127.0.0.1", "--port", str(port)],
                              cwd=root, env=env, stdout=log, stderr=log)
    try:
        deadline = time.monotonic() + 40
        while True:
            try:
                url = f"http://127.0.0.1:{port}/api/plugin?location[directory]={root}"
                import base64
                import re
                match = re.search(r"server password (\S+)", (root / "server.log").read_text())
                headers = {} if not match else {"Authorization": "Basic " + base64.b64encode(("opencode:" + match[1]).encode()).decode()}
                with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=3) as response:
                    result = json.load(response)
                if any(p.get("id") == "toggle-autoport" for p in result.get("data", [])):
                    break
                if time.monotonic() >= deadline:
                    raise RuntimeError("Plugin not loaded: " + json.dumps(result))
                time.sleep(0.2)
            except Exception:
                if time.monotonic() >= deadline or server.poll() is not None:
                    raise RuntimeError("Isolated server failed; inspect logs at " + str(root))
                time.sleep(0.2)
        loaded = next(p for p in result["data"] if p.get("id") == "toggle-autoport")
        print(json.dumps(loaded, indent=2))
        assert loaded["state"]["status"] == "active", loaded
        print("PASS: isolated OpenCode v2 loader; no CLI invocation. Logs:", root)
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait()
