# 藏舟 v0.4 UI 原型

这是与正式产品源码隔离的抛弃式原型。所有条目、连接测试和保存结果均为浏览器内存演示，不连接后端、不持久化真实数据。

## 运行

```bash
cd .workflow/ui-prototype
python3 -m http.server 4173
```

打开 `http://127.0.0.1:4173/`。

可用 URL 参数：

- `?surface=public&mode=original|apple`：方向 C 原版 / Apple 交互增强版。
- `?surface=admin&route=login&mode=original|apple`：管理端登录页对照。
- `?surface=admin&route=add|library|settings&mode=original|apple`：直接进入已登录管理页对照。
- 设置页可加 `&tab=models|schedule|rate|security|telegram|language`。

登录原型：用户名和密码可直接继续；v0.4 不包含 2FA。
