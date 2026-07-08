---
name: gsclaw-admin
description: >-
  管理 GSAI Office 配套服务端（gsclaw-server）：查看用户、按用户或全局配置客户端权限、
  新建账号、启用/禁用账号、重置密码。当用户想「管理员账号」「配置某个用户的权限」
  「隐藏/只读某个设置页」「禁止提交任务」「新建/禁用/重置用户」「查看有哪些用户」时使用。
  Manage the gsclaw-server backend: list users, set per-user or global client
  permissions (settings page visibility, submit permission), create/disable users,
  reset passwords.
official: true
---

# GSAI 服务端管理（gsclaw-admin）

这个 skill 让你通过 `gsclaw-server` 的管理接口，按用户或全局控制 GSAI Office 客户端的
权限与设置页显隐。所有操作都需要**管理员账号**。脚本只用 Python 标准库，无需安装依赖。

## 使用前：准备凭证

脚本需要管理员凭证和服务端地址。优先从环境变量读取；没有就向用户索要后临时传参。

- `GSCLAW_SERVER`：服务端地址，默认 `http://localhost:18300`
- `GSCLAW_ADMIN_USER` / `GSCLAW_ADMIN_PASSWORD`：管理员账号密码

**首次使用且环境变量未设置时，先向用户询问管理员账号、密码和服务器地址**，然后用
`--server/--user/--password` 传给脚本。不要把密码写进会被保存的文件。

**始终用 `$SKILLS_ROOT` 定位脚本。** 命令统一形如：

```bash
python "$SKILLS_ROOT/gsclaw-admin/scripts/gsclaw.py" <命令> [参数] \
  --server http://localhost:18300 --user admin --password '<管理员密码>'
```
若已设置环境变量，可省略 `--server/--user/--password`。

## 命令

### 查看所有用户（含每人的配置覆盖）
```bash
python "$SKILLS_ROOT/gsclaw-admin/scripts/gsclaw.py" list-users
```

### 查看当前生效的全局配置
```bash
python "$SKILLS_ROOT/gsclaw-admin/scripts/gsclaw.py" get-config
```

### 修改全局配置（对所有用户生效，传部分字段即可，深合并）
```bash
python "$SKILLS_ROOT/gsclaw-admin/scripts/gsclaw.py" set-config '{"permissions":{"allowSubmit":false}}'
```

### 按用户配置权限（只影响该用户，优先级高于全局）
```bash
# 让 id=2 的用户隐藏「模型」设置页、禁止提交任务
python "$SKILLS_ROOT/gsclaw-admin/scripts/gsclaw.py" set-user-config 2 '{"settingsPages":{"model":"hidden"},"permissions":{"allowSubmit":false}}'
# 清除该用户的覆盖，回到全局配置
python "$SKILLS_ROOT/gsclaw-admin/scripts/gsclaw.py" clear-user-config 2
```

### 新建 / 禁用启用 / 重置密码
```bash
python "$SKILLS_ROOT/gsclaw-admin/scripts/gsclaw.py" create-user zhangsan 'Init@123456' --display 张三 --role user
python "$SKILLS_ROOT/gsclaw-admin/scripts/gsclaw.py" set-user-status 3 0   # 0=禁用 1=启用
python "$SKILLS_ROOT/gsclaw-admin/scripts/gsclaw.py" reset-password 3 'New@123456'
```

## 配置字段说明

`set-config` / `set-user-config` 的 JSON 支持以下字段（只传要改的）：

- `features.customModel`：`true|false` —— 是否展示自定义模型入口。
- `settingsPages.<页>`：`hidden`（不展示该设置页）/ `readonly`（可看不可改）/ `editable`（可改）。
  可用页名：`general` `appearance` `coworkAgentEngine` `model` `browserWebAccess`
  `coworkMemory` `coworkDreaming` `shortcuts` `im` `email` `plugins` `about`。
- `permissions.allowSubmit`：`true|false` —— 是否允许提交新任务。

客户端在窗口聚焦或每 5 分钟自动刷新配置，改动最迟下次刷新生效。

## 注意

- 修改全局配置会影响**所有**已登录用户，操作前先向用户确认范围。
- 只有 `role=admin` 的账号能调用这些接口；用普通账号会被拒绝。
- 输出为 JSON；`set-user-config` 会返回该用户合并后的最终生效配置（`effectiveConfig`），可据此核对。
