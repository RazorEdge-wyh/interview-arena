/* 可选：自托管时把 AI 配置写在这里（会被公开，仅用于你自己的部署）。
 * 公开站点不要把真实 Key 提交到仓库；优先用 URL 参数一次性写入本机：
 *   https://<site>/?key=sk-xxx&model=deepseek-flash
 *
 * apiBase：发信后端地址（Vercel 部署得到的 https://xxx.vercel.app，会自动拼 /api/send）
 * apiEndpoint：发信接口完整地址（腾讯云函数 API 网关地址，直接使用，不拼路径）
 *   两者填一个即可；都留空则回退到"邮件客户端/复制/下载文件"方式。
 * apiSecret：与后端环境变量 API_SECRET 一致（可选，挡掉随意调用）。
 */
window.__IA_CONFIG__ = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  apiBase: '',
  apiEndpoint: '',
  apiSecret: '',
};
