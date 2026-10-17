# Wattwise V2 本地预览

原版： http://localhost:8770/index.html  
新版： http://localhost:8772/index.html

基于 `1a20299ce41ff00e87481e1e20e52092ee714b69`。当前 8771 目录虽然命名为 latest，其提交 `47dcd44` 是本版本的父提交。

范围：设备分类行为说明与房间视图；建议预览、确认、取消和恢复；持续可见的模拟数据标识；停电状态的信息优先级；首页用电曲线与比较基线、状态同步。

保留原有视觉风格和模拟模型。新版是独立 worktree，不修改原目录、原服务或远程仓库。

## 启动

在本目录运行：

```sh
python3 -m http.server 8772 --bind 127.0.0.1
```

验证结果与截图见 `research-wiki/preview-verification.md`。运行日志位于被 Git 忽略的 `.aris/runtime/`。
