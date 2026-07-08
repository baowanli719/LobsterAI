#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gsclaw-admin —— GSAI Office 配套服务端（gsclaw-server）管理命令行。

只用 Python 标准库，无需 pip install。所有命令内部会先用管理员账号登录换取 token，
再调用对应的 admin 接口。

凭证与地址来源（命令行参数优先于环境变量）：
  --server / GSCLAW_SERVER          服务端地址，默认 http://localhost:18300
  --user   / GSCLAW_ADMIN_USER      管理员账号
  --password / GSCLAW_ADMIN_PASSWORD 管理员密码

命令：
  list-users
  get-config
  set-config '<json>'                     更新全局配置（部分字段深合并）
  set-user-config <userId> '<json>'       给某用户设置配置覆盖（部分字段深合并）
  clear-user-config <userId>              清除某用户的配置覆盖
  create-user <username> <password> [--display 名称] [--role user|admin]
  set-user-status <userId> <0|1>          0=禁用 1=启用
  reset-password <userId> <newPassword>

配置字段（set-config / set-user-config 的 json）：
  {"features":{"customModel":true|false},
   "settingsPages":{"<页>":"hidden|readonly|editable"},
   "permissions":{"allowSubmit":true|false}}
  设置页 <页> 取值：general appearance coworkAgentEngine model browserWebAccess
                   coworkMemory coworkDreaming shortcuts im email plugins about
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

# Windows 控制台默认编码可能不是 UTF-8，用户名/配置含中文时会 UnicodeEncodeError
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def _req(method, url, token=None, body=None, timeout=15):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            msg = json.loads(raw).get("message", raw)
        except Exception:
            msg = raw
        raise SystemExit("[gsclaw] 请求失败 %s: %s" % (e.code, msg))
    except urllib.error.URLError as e:
        raise SystemExit("[gsclaw] 无法连接服务端 %s：%s" % (url, e.reason))


def _parse_json_arg(s):
    try:
        obj = json.loads(s)
    except json.JSONDecodeError as e:
        raise SystemExit("[gsclaw] 配置不是合法 JSON：%s" % e)
    if not isinstance(obj, dict):
        raise SystemExit("[gsclaw] 配置必须是 JSON 对象")
    return obj


def _out(obj):
    print(json.dumps(obj, ensure_ascii=False, indent=2))


class Client:
    def __init__(self, server, user, password):
        self.base = server.rstrip("/")
        self.user = user
        self.password = password
        self._token = None

    def token(self):
        if self._token:
            return self._token
        if not self.user or not self.password:
            raise SystemExit(
                "[gsclaw] 缺少管理员凭证。请设置环境变量 GSCLAW_ADMIN_USER / "
                "GSCLAW_ADMIN_PASSWORD，或用 --user/--password 传入。"
            )
        res = _req("POST", self.base + "/api/auth/login",
                   body={"username": self.user, "password": self.password})
        if (res.get("user") or {}).get("role") != "admin":
            raise SystemExit("[gsclaw] 该账号不是管理员，无法调用管理接口。")
        self._token = res["token"]
        return self._token

    def list_users(self):
        return _req("GET", self.base + "/api/admin/users", self.token())

    def get_config(self):
        return _req("GET", self.base + "/api/client-config", self.token())

    def set_config(self, cfg):
        return _req("PUT", self.base + "/api/admin/client-config", self.token(), cfg)

    def set_user_config(self, uid, cfg):
        return _req("PUT", "%s/api/admin/users/%d/config-override" % (self.base, uid),
                    self.token(), cfg)

    def clear_user_config(self, uid):
        return _req("PUT", "%s/api/admin/users/%d/config-override" % (self.base, uid),
                    self.token(), {"clear": True})

    def create_user(self, username, password, display, role):
        body = {"username": username, "password": password, "role": role}
        if display:
            body["displayName"] = display
        return _req("POST", self.base + "/api/admin/users", self.token(), body)

    def update_user(self, uid, body):
        return _req("PUT", "%s/api/admin/users/%d" % (self.base, uid), self.token(), body)


def main():
    # 凭证参数放到 parent parser，让它在子命令前后都能出现（agent 常写在命令后面）
    cred = argparse.ArgumentParser(add_help=False)
    cred.add_argument("--server", default=argparse.SUPPRESS)
    cred.add_argument("--user", default=argparse.SUPPRESS)
    cred.add_argument("--password", default=argparse.SUPPRESS)

    p = argparse.ArgumentParser(prog="gsclaw", parents=[cred])
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list-users", parents=[cred])
    sub.add_parser("get-config", parents=[cred])

    sp = sub.add_parser("set-config", parents=[cred])
    sp.add_argument("json")

    sp = sub.add_parser("set-user-config", parents=[cred])
    sp.add_argument("user_id", type=int)
    sp.add_argument("json")

    sp = sub.add_parser("clear-user-config", parents=[cred])
    sp.add_argument("user_id", type=int)

    sp = sub.add_parser("create-user", parents=[cred])
    sp.add_argument("username")
    sp.add_argument("password")
    sp.add_argument("--display", default="")
    sp.add_argument("--role", default="user", choices=["user", "admin"])

    sp = sub.add_parser("set-user-status", parents=[cred])
    sp.add_argument("user_id", type=int)
    sp.add_argument("status", type=int, choices=[0, 1])

    sp = sub.add_parser("reset-password", parents=[cred])
    sp.add_argument("user_id", type=int)
    sp.add_argument("new_password")

    args = p.parse_args()
    server = getattr(args, "server", None) or os.environ.get("GSCLAW_SERVER", "http://localhost:18300")
    user = getattr(args, "user", None) or os.environ.get("GSCLAW_ADMIN_USER", "")
    password = getattr(args, "password", None) or os.environ.get("GSCLAW_ADMIN_PASSWORD", "")
    c = Client(server, user, password)

    if args.cmd == "list-users":
        _out(c.list_users())
    elif args.cmd == "get-config":
        _out(c.get_config())
    elif args.cmd == "set-config":
        _out(c.set_config(_parse_json_arg(args.json)))
    elif args.cmd == "set-user-config":
        _out(c.set_user_config(args.user_id, _parse_json_arg(args.json)))
    elif args.cmd == "clear-user-config":
        _out(c.clear_user_config(args.user_id))
    elif args.cmd == "create-user":
        _out(c.create_user(args.username, args.password, args.display, args.role))
    elif args.cmd == "set-user-status":
        _out(c.update_user(args.user_id, {"status": args.status}))
    elif args.cmd == "reset-password":
        _out(c.update_user(args.user_id, {"password": args.new_password}))


if __name__ == "__main__":
    main()
