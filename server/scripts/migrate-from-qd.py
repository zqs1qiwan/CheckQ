import json
import re
import sqlite3
import sys

QD_DB = "/usr/src/app/config/database.db"
OUT = "/tmp/qd_migrated_flows.json"
TARGET_USER = 1  # 老白


def qd_tpl_to_flow(tpl_row, task_row, env_data, crypto, userkey):
    """把 QD tpl.har + task env 转成一个 CheckQ flow"""
    har_raw = tpl_row["har"]
    if isinstance(har_raw, str):
        har_raw = har_raw.encode("utf-8")
    if not isinstance(har_raw, bytes):
        raise ValueError("tpl har 类型异常: %s" % type(har_raw).__name__)

    # tpl.har 也是加密存储的：优先当前任务 user 的 key，再回退全局 aes_key
    decrypted = None
    for key in (userkey, None):
        try:
            decrypted = crypto.aes_decrypt(har_raw, key)
            break
        except Exception:
            continue
    if decrypted is None:
        raise ValueError("tpl %s har 解密失败" % tpl_row["id"])

    if isinstance(decrypted, bytes):
        decrypted = decrypted.decode("utf-8", "replace")
    har = json.loads(decrypted) if isinstance(decrypted, str) else decrypted

    if "log" in har and "entries" in har.get("log", {}):
        entries = har["log"]["entries"]
    elif "tpl" in har:
        entries = [e for t in har["tpl"] for e in (t if isinstance(t, list) else [t])]
    else:
        return None

    nodes = []
    edges = []
    prev_id = None
    prev_handle = None
    idx = 0

    def chain(node, out_handle="next"):
        nonlocal prev_id, prev_handle, idx
        node["x"] = 80 + (idx % 6) * 260
        node["y"] = 60 + (idx // 6) * 160
        nodes.append(node)
        if prev_id is not None:
            edges.append({
                "id": "e%d" % idx,
                "source": prev_id,
                "sourceHandle": prev_handle or "",
                "target": node["id"],
            })
        prev_id = node["id"]
        prev_handle = out_handle
        idx += 1

    for entry in entries:
        if entry.get("checked") is False:
            continue
        req = entry.get("request") or {}
        rule = entry.get("rule") or {}
        method = (req.get("method") or "GET").upper()
        url = req.get("url") or ""

        # QD __log__ hack: localhost string/replace → log 节点
        if "localhost" in url or "127.0.0.1" in url:
            params = _parse_qs(url)
            text = params.get("s", "") + params.get("p", "")
            text = re.sub(r"\|(?:urlencode|json)\}\}", "}}", text)
            if text.strip():
                chain({"id": "n%d" % idx, "type": "log", "name": "输出日志",
                       "config": {"text": text}}, "next")
            continue

        if not re.match(r"^https?://", url):
            continue

        headers = []
        for h in req.get("headers", []):
            name = (h.get("name") or "").strip().lower()
            if not name or name.startswith(":"):
                continue
            if name in ("accept-encoding", "content-length", "host", "connection"):
                continue
            if h.get("checked") is False:
                continue
            value = h.get("value", "")
            # QD 模板里 cookie 头尾部可能有换行残留，剥掉
            if name == "cookie":
                value = value.rstrip("\n\r ")
            headers.append({"name": h.get("name"), "value": value, "enabled": True})

        post = req.get("postData") or {}
        body = post.get("text") if isinstance(post, dict) else post

        asserts = []
        for a in (rule.get("success_asserts") or []):
            asserts.append({"res": [a["re"]], "from": a.get("from", "content")})
        for a in (rule.get("failed_asserts") or []):
            asserts.append({"res": [a["re"]], "from": a.get("from", "content"), "negate": True})

        node_id = "n%d" % idx
        chain({
            "id": node_id, "type": "http",
            "name": "%s %s" % (method, url.split("?")[0].split("/")[-1][:24]),
            "config": {
                "method": method, "url": url,
                "headers": headers, "body": body or "", "asserts": asserts,
            },
        }, "success")

        # extract_variables → 紧随其后 extract 节点
        for ev in (rule.get("extract_variables") or []):
            chain({
                "id": "n%d" % idx, "type": "extract", "name": "提取 " + ev["name"],
                "config": {"from": "last.text", "re": ev["re"], "name": ev["name"], "optional": True},
            }, "next")

    if not nodes:
        return None

    # 变量: QD task.env 用户实际填写值 → flow.vars（跳过系统变量与模板输出变量）
    SKIP = {"New_group", "_proxy", "retry_count", "retry_interval", "__log__", "_name",
            "gld", "gld_points_balance", "gld_days", "email", "points", "score",
            "desc", "cur", "token", "rank", "bq", "qd", "ml", "lxqd", "xz", "sc", "fx",
            "done", "sm", "total_qd", "qd_count", "log_value", "msg0", "tsp", "id"}
    vars_ = {}
    for k, v in (env_data or {}).items():
        if k in SKIP:
            continue
        if k.startswith("group-select"):
            continue
        if isinstance(v, str) and v.strip():
            vars_[k] = v

    name = task_row["note"] or ("QD task " + str(task_row["id"]))
    site = tpl_row["sitename"] or ""
    flow_name = (site + " - " + name).strip(" -")

    return {
        "name": (flow_name[:60] + " #" + str(task_row["id"])),
        "note": "从 QD 迁移 (tpl %s)" % tpl_row["id"],
        "vars": vars_,
        "nodes": nodes,
        "edges": edges,
        "cron": "",
        "enabled": False,  # 迁移后停用，验证通过再启用
    }


def _parse_qs(url):
    out = {}
    m = re.search(r"\?(.*)$", url)
    if not m:
        return out
    for kv in m.group(1).split("&"):
        if "=" in kv:
            k, v = kv.split("=", 1)
            out[k] = v
    return out


def main():
    sys.path.insert(0, "/usr/src/app")
    from libs import mcrypto as crypto

    conn = sqlite3.connect(QD_DB)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    c.execute("SELECT userkey FROM user WHERE id=?", (TARGET_USER,))
    userkey = crypto.aes_decrypt(c.fetchone()[0])

    c.execute("SELECT id, userid, siteurl, sitename, har, variables, note FROM tpl")
    tpls = {r["id"]: r for r in c.fetchall()}

    c.execute("SELECT id, tplid, note, disabled, env, init_env FROM task WHERE userid=? AND disabled=0", (TARGET_USER,))
    tasks = c.fetchall()

    flows = []
    skipped = []
    for t in tasks:
        tpl = tpls.get(t["tplid"])
        if not tpl:
            skipped.append((t["id"], "tpl missing"))
            continue
        env_data = {}
        # QD 取值顺序: 用户 env 覆盖 init_env（env 是用户在 UI 里保存的值，init_env 是建任务时的初始值）
        for src in ("init_env", "env"):
            raw = t[src]
            if raw is None:
                continue
            try:
                data = crypto.aes_decrypt(raw, userkey)
                if isinstance(data, dict):
                    for k, v in data.items():
                        if isinstance(v, (str, int, float)) and str(v).strip():
                            env_data[str(k)] = str(v)
            except Exception as e:
                if src == "env":
                    skipped.append((t["id"], "decrypt env: " + str(e)[:50]))
        try:
            flow = qd_tpl_to_flow(tpl, t, env_data, crypto, userkey)
        except Exception as e:
            skipped.append((t["id"], str(e)[:60]))
            continue
        if flow is None:
            skipped.append((t["id"], "no nodes"))
            continue
        flows.append(flow)

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(flows, f, ensure_ascii=False, indent=2)

    print("migrated:", len(flows))
    print("skipped:", len(skipped))
    for sid, reason in skipped:
        print("  skip", sid, reason)


if __name__ == "__main__":
    main()
