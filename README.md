# 布鲁斯 BSC Buy Telegram Bot (V3 完整版)

功能说明：
- 监听 BSC（BNB Chain）上代币 `布鲁斯` (Contract: 0x3aebd0f979c5c20ea8de568105e91c17f2fa4444)
- 仅播报 **Buy（买入）**，当买入的 **等值 USD >= MIN_USD（环境变量）** 时才触发
- 自动抓取 Token 价格（GeckoTerminal）、BNB 价格（Binance），计算市值（Market Cap = totalSupply * price）
- 判断是否为 **新持有者**（买方在前一个区块对该代币余额为 0）
- 使用 Telegram Bot 发送格式化中文消息（样式：🔥 布鲁斯 买入）
- 可部署于 Railway / Heroku / 任何支持 Node 的平台

部署步骤（Railway）：
1. 将本仓库 push 到 GitHub。
2. 在 Railway 创建新项目 -> Deploy from GitHub，选择此仓库。
3. 在 Railway 项目 Settings -> Variables 添加环境变量（注意不要将 Token 推到 GitHub）：
   - TG_BOT_TOKEN  你的 Telegram Bot Token
   - TG_CHAT_ID    群组 ID，格式：-1001234567890
   - CONTRACT      0x3aebd0f979c5c20ea8de568105e91c17f2fa4444
   - POOL          0x35502f66ff7edb2be43b96d5931a8d340eaddf27
   - BSC_WSS       wss://bsc-ws-node.nariox.org:443
   - MIN_USD       10

4. Deploy，并查看日志确认 `Bot started`。

安全提醒：
- 如果 Bot Token 泄露，请在 BotFather 执行 `/revoke` 并生成新 Token，然后在 Railway 更新变量.
