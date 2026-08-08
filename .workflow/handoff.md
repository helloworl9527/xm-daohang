# Handoff

- Target role: implementation_agent（团队成员「Codex 方案实施工程师」）；阶段验收由「Codex 阶段验收员」，架构师协调
- Stage: implementation
- Plan revision: 5（canonical，不得重新设计）
- Validation: PASS（validate_workflow.py，stage=implementation revision=5）
- Canonical files: requirements.md(v0.4), ui-spec.md(v0.4), decisions.md(D-01~D-04 定稿), implementation-plan.md(rev5), review-ledger.md, final-audit.md, state.json
- Approvals: requirements/ui/codex/implementation 均 approved；用户原文"接受风险，开始实施"@2026-08-08T22:36:58+08:00
- 已接受风险：AR-001（Telegram sendMessage at-least-once，崩溃窗口可能重复一条回执）。实施须保留 duplicate_possible 指标，并在 implementation-report.md 记录最终处理。
- 交付文档须澄清：OBS-01——GitHub 可选 token 仅提升公开 API 配额、不解锁私有仓库（private=false 硬校验），符合"仅抓公开内容"边界。
- Next action:
  1. Codex 方案实施工程师严格按 implementation-plan.md rev5 逐任务 TDD 实施（T01→T25），不得重新设计、不得改变已确认产品行为/UI/数据暴露边界。
  2. 每完成一个可验收阶段，交 Codex 阶段验收员做阶段验收；验收员升级疑难时由架构师裁决。
  3. 完成后产出 implementation-report.md（实现范围、变更组件、迁移、验证命令与结果、偏差、残余风险）。
  4. 生产发布快照、最终审计与用户 go/no-go 属发布前另行门禁，不在本阶段擅自部署/打 Tag/推送/操作生产数据。
