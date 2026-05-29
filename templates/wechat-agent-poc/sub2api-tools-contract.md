# Sub2API Agent Tools Contract

这个文件定义下一步给 Hermes 或其他 Agent 调用的最小工具边界。当前 POC 只验证微信通道，暂不执行真实 CDK 兑换。

## Tool Boundary

Agent 只能调用 HTTP 工具服务，不直接连数据库，不直接读取 CDK 明文日志。

推荐工具：

```text
GET  /agent-tools/pool/status?group=plus
POST /agent-tools/plus/import-jobs
GET  /agent-tools/plus/import-jobs/{id}
POST /agent-tools/plus/import-jobs/{id}/retry
POST /agent-tools/accounts/{id}/disable
POST /agent-tools/accounts/{id}/enable
```

## Import Job

```json
{
  "requester_wechat_id": "wxid_xxx",
  "group": "plus",
  "cdk": "redacted-at-rest",
  "dry_run": true
}
```

状态机：

```text
pending
validating_cdk
redeeming
importing_account
assigning_group
healthchecking
enabled
failed
```

## Safety

```text
群聊只能查询状态和创建 dry-run job
真实 CDK 只允许私聊或 sub2api 管理页提交
所有写操作必须校验 requester_wechat_id allowlist
所有 CDK 日志必须脱敏
同一个 CDK hash 必须幂等
失败 job 必须保留 error_code 和 redacted_error
```
