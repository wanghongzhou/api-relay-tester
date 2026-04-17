#!/usr/bin/env tsx
import { app } from './app.js';

const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '3000', 10);

app.listen(PORT, () => {
  console.log(`\n  模型测试工具 — Web 界面`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`\n  复制上方地址到浏览器打开\n`);
});
