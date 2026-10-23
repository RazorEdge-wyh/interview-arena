/* 可选：自托管时把 AI 配置写在这里（会被公开，仅用于你自己的部署）。
 * 公开站点不要把真实 Key 提交到仓库；优先用 URL 参数一次性写入本机：
 *   https://<site>/?key=sk-xxx&model=deepseek-flash
 *
 * apiBase：发邮件的后端地址（Vercel 部署后得到的地址，例如 https://xxx.vercel.app）
 * 留空则不启用后端，回退到"邮件客户端/复制/下载文件"方式。
 * apiSecret：与 Vercel 环境变量 API_SECRET 一致（可选，挡掉随意调用）。
 */
window.__IA_CONFIG__ = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  apiKey: '',
  apiBase: '',
  apiSecret: '',
};
