# WeChat Agent POC

这个 POC 只验证三件事：

1. 能不能扫码绑定微信机器人身份。
2. 能不能把机器人/微信号拉进普通微信群。
3. 群里发消息后，事件能不能进入 webhook，并能不能回复到群里。

先不要接真实 CDK。这里的 `/add-plus-dry-run` 只返回假任务，确认通道可用后再接 `sub2api` 的真实加号工具。

## Start

```bash
cd "/Users/zyaire/Documents/API Router/sub2api/deploy/wechat-agent-poc"
cp .env.example .env
./scripts/start.sh
```

打开：

```text
http://192.220.25.138:9800
```

本机开发时再把 `.env` 改回：

```dotenv
OPENILINK_PUBLIC_ORIGIN=http://localhost:9800
OPENILINK_RP_ID=localhost
```

## OpeniLink Setup

当前 192 POC 已经完成基础配置：

```text
Bot ID: 00612ba4-f96b-4f19-ad75-c3913e92cf75
Channel: Sub2API POC
Webhook URL: http://poc-webhook:9811/webhook
Webhook script: plugins/reply-from-webhook.js
AI auto-reply: disabled
Data dir: /opt/sub2api/openilink-hub-data
```

如果重新从零部署，在 OpeniLink Hub 后台完成：

1. 注册第一个账号，第一个注册用户会成为管理员。
2. 进入 Bot 管理，扫码绑定微信机器人身份。
3. 在这个 Bot 下创建一个 Channel。
4. 在 Channel 设置中启用 Webhook。
5. Webhook URL 填 `http://poc-webhook:9811/webhook`。
6. 如果 `.env` 设置了 `POC_WEBHOOK_TOKEN`，认证方式选 Bearer Token，并填入同一个 token。
7. 在 Channel 的 Webhook 插件里安装 `plugins/reply-from-webhook.js` 的内容。
8. 关闭内置 AI 自动回复，先只测 Webhook 通道。

OpeniLink 官方文档里，Webhook 会把消息 POST 到 URL；要把 webhook JSON 响应里的 `reply` 发回微信，需要响应后插件调用 `ctx.reply()`。

## Verification

先私聊机器人：

```text
/ping
/status plus
/add-plus-dry-run
```

再拉进普通微信群，群里发：

```text
@机器人 /ping
@机器人 /status plus
@机器人 /add-plus-dry-run
```

如果群聊不支持 `@机器人`，也测试直接发：

```text
/ping
```

## Logs

本地探测 webhook：

```bash
./scripts/probe-webhook.sh
```

查看 webhook 是否收到事件：

```bash
./scripts/logs.sh
```

查看整体状态：

```bash
./scripts/status.sh
```

## Deploy To 192

如果本机能 SSH 到 192：

```bash
./scripts/deploy-to-192.sh
```

默认目标：

```text
root@192.220.25.138:/opt/sub2api/wechat-agent-poc
```

如果服务器没有 Docker，并且是 Ubuntu：

```bash
ssh root@192.220.25.138
cd /opt/sub2api/wechat-agent-poc
./scripts/install-prereqs-ubuntu.sh
./scripts/start.sh
```

关键字段：

```text
payload.type
payload.content
payload.sender.user_id
payload.sessionID
payload.channel_id
```

如果私聊能收、群里收不到，说明 Agent 层没有问题，限制在微信/iLink 群事件投递。不同 OpeniLink 版本的群字段可能叫 `group`、`room` 或只体现在 `sessionID` 里，所以先以日志里的实际 payload 为准。

## Pass Criteria

这几项都通过，再接 Hermes 和真实 sub2api 加号流程：

```text
私聊 /ping 有回复
群里能看到机器人身份
群里 @机器人 /ping 有回复
webhook 日志里出现 group.id
webhook 日志里 sender.id 稳定
重复发送不会多次触发异常回复
```

## Next Step

真实加号流程建议只暴露成受控工具：

```text
validate_cdk
redeem_cdk_to_plus_account
import_account_to_pool
assign_group("plus")
healthcheck_account
enable_account
report_result_to_wechat
```

CDK 不建议发在群里。群里只触发任务或查询状态，真实 CDK 走私聊或 sub2api 管理页面。
