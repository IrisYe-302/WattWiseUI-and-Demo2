# Wattwise 现场演示脚本（约 2 分钟）

打开 `index.html`（本地：`http://localhost:8770`）。不需要联网，图标和字体都在本地。

## 操作方式

- **G**：打开或隐藏演示引导面板（排练时用）。
- **数字键 1 到 8**：直接执行对应步骤，屏幕上不显示引导面板。投影是镜像模式时用这个，评委看不到提示。
- 按 **1** 会把页面恢复到干净的初始状态（模式、建议、设备、聊天记录都会重置），每次上台前按一次。
- 左下角头像 → Settings → "Reset demo data" 会清掉改过的名字、预算和电价方案。

## 步骤与台词

| 键 | 画面 | 英文台词（照着说） | 中文提示 |
| --- | --- | --- | --- |
| 1 | 回到 Normal，首页 | "This is Iris's home. Right now it uses 1.3 kW, and the bill is on track for the month." | 指一下当前用电和账单卡片 |
| 2 | 切到 Saver，梯子亮第 1、2 档 | "Every day, Wattwise cuts standby waste the household approved and moves the water heater to cheaper hours. That's 0.4 kW less, without anyone noticing." | 指梯子和 "0.4 kW lower" |
| 3 | 应用待机建议 | "Each approval teaches Wattwise what can safely pause. This one is worth about 59 dollars a year." | 电视、游戏机变成已暂停 |
| 4 | 进入 Ports 页并自动扫描 | "Wattwise finds what is plugged in, recognizes it by its power signature, and decides which loads can respond in an outage. The household still decides what is critical." | 扫描约 3 秒，出现 3 个设备和置信度。可以再现场把医用冷藏箱改成 Flexible，展示确认弹窗，点 "Keep it critical" |
| 5 | 模拟 48 小时山火断电 | "Now a wildfire safety shutoff, 48 hours. On battery at Level 3, the home would last about 11 hours. That's not enough, so Wattwise steps down to critical only. Now it lasts about 60 hours." | 等 3 秒，梯子会从第 3 档自动跳到第 4 档 |
| 6 | 打开助手并提问 | "Anyone in the home can ask how long the power will last, in plain words." | 助手会说出 11h 20m 和 60h 45m |
| 7 | 恢复供电 | "When the grid comes back, everything returns on its own." | 回到 Saver |
| 8 | History 页 | "Over four weeks: 11 percent less energy, 38 kWh saved, about 23 dollars. And here is everything Wattwise just did, including one night the Wi-Fi went down and it kept control through the power line." | 指"Where the savings came from"和右侧 Activity。刚才演示的每一步都出现在 Activity 最上面；可以点 Network 筛选，展示 10 月 15 日断网走电力线那条 |

## 如果评委问

- **"4 小时的短停电呢？"** 点左侧 "Grid connected" 卡片 → 选 "4 hours" → Simulate an outage。系统会停在第 3 档，因为 11 小时已经够用，不会无谓地关掉舒适负载。
- **"电价怎么算的？"** 按南加州爱迪生（SCE）TOU-D-4-9PM 分时电价，全天平均约 38.5 美分/度。在 Settings 里可以切到 LADWP 阶梯电价，所有省钱数字会重新计算。
- **"数据是真的吗？"** 这是软件演示，数据是按真实设备功率和电价设定的合理示例，不是实测。

## 数字对照（确保台词和屏幕一致）

| 项目 | 数值 |
| --- | --- |
| 电池可用电量 | 13.5 kWh × 82% × 90% ≈ 10.0 kWh |
| 第 3 档负载 / 续航 | 0.88 kW / 11h 20m |
| 第 4 档负载 / 续航 | 164 W（冰箱 72 + 医用冷藏箱 74 + 路由器 18）/ 60h 45m |
| 扫描结果 | 医用冷藏箱 99%、电视 96%、床头灯 82%（仅推断，不自动控制）|
| 待机建议 | 21 W，每天约 20 小时，约 150 kWh/年，SCE 电价下约 $59/年 |
| 4 周用电 | 去年同期 349 kWh，今年 311 kWh，少 11%，省 38 kWh |
| 4 周省钱 | 少用电 $14.63 + 错峰 $8.16 = $22.79（SCE 电价）|
