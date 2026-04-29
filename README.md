# OpenClaw Router

本地部署的 AI 模型路由网关，提供统一的 OpenAI 兼容 API 聚合多个 AI 提供商。

一个接口访问 GPT、Claude、Gemini、GLM、Mistral、Ollama 等所有模型。

## 特性

- **OpenAI 100% 兼容** — `/v1/chat/completions`、`/v1/models`，可直接对接 Claude Code、OpenAI SDK 等工具
- **多提供商适配** — OpenAI、Anthropic、Google Gemini、Mistral、OpenAI-Compatible (Ollama/vLLM)
- **多提供商回退** — 主提供商失败自动切换备用
- **流式 SSE** — 完整支持 `stream: true`，流结束后异步计费
- **API Key 管理** — 按 Key 独立认证和限流
- **余额与计费** — 按 Token 用量扣费，支持充值和交易记录
- **用量统计** — 请求级别日志，含 Token、延迟、费用
- **Web 管理面板** — 暗色主题，含仪表盘、图表、完整 CRUD

## 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 安装

```bash
git clone https://github.com/huzhongx/OpenClaw-router.git
cd OpenClaw-router
npm install
```

### 配置

```bash
cp .env.example .env
# 编辑 .env，至少设置 ADMIN_JWT_SECRET
```

### 初始化数据

```bash
npm run seed
```

### 启动

```bash
# 开发模式
npm run dev

# 生产模式
npm run build
npm start

# PM2 部署
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

启动后访问：
- 管理面板：`http://localhost:3000/`
- API 端点：`http://localhost:3000/v1/`
- 默认账号：`admin` / `admin123`

## 配置说明

### 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `PORT` | 否 | `3000` | 服务端口 |
| `HOST` | 否 | `0.0.0.0` | 监听地址 |
| `NODE_ENV` | 否 | `development` | 运行环境 |
| `ADMIN_JWT_SECRET` | **是** | - | JWT 签名密钥 |
| `ADMIN_USERNAME` | 否 | `admin` | 初始管理员用户名 |
| `ADMIN_PASSWORD` | 否 | `admin123` | 初始管理员密码 |
| `DB_PATH` | 否 | `./data/openclaw.db` | SQLite 数据库路径 |
| `API_KEY_PREFIX` | 否 | `ocr` | 生成的 API Key 前缀 |
| `RATE_LIMIT_DEFAULT_RPM` | 否 | `60` | 默认每 Key 每分钟请求限制 |
| `MINIMUM_BALANCE_CENTS` | 否 | `0` | 最低余额阈值（0=不检查） |
| `LOG_LEVEL` | 否 | `info` | 日志级别 |
| `OPENAI_API_KEY` | 否 | - | OpenAI API Key（覆盖数据库配置） |
| `ANTHROPIC_API_KEY` | 否 | - | Anthropic API Key |
| `GEMINI_API_KEY` | 否 | - | Google Gemini API Key |
| `MISTRAL_API_KEY` | 否 | - | Mistral API Key |
| `PROVIDER_<NAME>_BASE_URL` | 否 | - | 自定义提供商 Base URL |
| `PROVIDER_<NAME>_API_KEY` | 否 | - | 自定义提供商 API Key |

### 添加提供商

在管理面板的 **Providers** 页面添加，或通过环境变量配置。

#### OpenAI

```env
OPENAI_API_KEY=sk-xxx
```

#### Anthropic

```env
ANTHROPIC_API_KEY=sk-ant-xxx
```

#### Google Gemini

```env
GEMINI_API_KEY=xxx
```

#### GLM Token Plan (智谱)

管理面板添加 Provider：
- **Type**: `Anthropic`
- **Base URL**: `https://open.bigmodel.cn/api/anthropic/v1`
- **API Key**: 你的智谱 Token
- **Config JSON**: `{"auth_type":"authorization"}`

> `auth_type: "authorization"` 让适配器使用 `Authorization` header 而非 `x-api-key`

#### Ollama (本地)

管理面板添加 Provider：
- **Type**: `OpenAI-Compatible`
- **Base URL**: `http://localhost:11434/v1`
- **API Key**: `ollama`（任意值即可）

#### vLLM (本地)

- **Type**: `OpenAI-Compatible`
- **Base URL**: `http://localhost:8000/v1`

### 添加模型

在管理面板的 **Models** 页面添加，关联到已配置的 Provider。

## API 文档

### 认证

所有 `/v1/` 和 `/user/` 接口需要 API Key 认证：

```
Authorization: Bearer ocr-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### POST /v1/chat/completions

与 OpenAI API 完全兼容。

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer ocr-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello!"}
    ],
    "temperature": 0.7,
    "max_tokens": 1000,
    "stream": false
  }'
```

**流式请求：**

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer ocr-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

**工具调用 (Tool Use)：**

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer ocr-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "What is the weather?"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get the current weather",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string"}
          }
        }
      }
    }]
  }'
```

### GET /v1/models

列出所有可用模型。

```bash
curl http://localhost:3000/v1/models \
  -H "Authorization: Bearer ocr-xxx"
```

### GET /user/balance

查询当前余额和最近交易。

### GET /user/usage

查询用量日志（分页）。

### GET /user/keys

列出当前用户的所有 API Key。

## 管理面板

管理面板提供完整的平台管理功能：

| 页面 | 功能 |
|------|------|
| Dashboard | 总览统计、每日用量图表 |
| Users | 创建/编辑用户、充值余额 |
| API Keys | 创建/撤销 Key、限流设置 |
| Providers | 添加/编辑提供商、连接测试 |
| Models | 添加/编辑模型、设置定价 |
| Routes | 配置多提供商回退链 |
| Usage Logs | 查看所有请求日志（筛选/分页） |
| Billing | 查看所有交易记录 |

## 路由回退

在 Routes 页面可以为一个虚拟模型配置多个提供商，按优先级回退：

```
用户请求 gpt-4o
  → Provider A (OpenAI) — 失败
  → Provider B (Anthropic) — 失败
  → Provider C (Ollama) — 成功
```

## 错误格式

所有错误遵循 OpenAI 错误格式：

```json
{
  "error": {
    "message": "Model not found: xxx",
    "type": "invalid_request_error",
    "param": null,
    "code": "model_not_found"
  }
}
```

## 对接 Claude Code

```bash
export OPENAI_API_KEY=ocr-<your-api-key>
export OPENAI_BASE_URL=http://localhost:3000/v1
```

## 对接其他 OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    api_key="ocr-xxx",
    base_url="http://localhost:3000/v1"
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

## 部署

### PM2（推荐）

```bash
npm run build
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

### Docker

```bash
docker-compose up -d
```

### Nginx 反向代理（HTTPS + 外网访问）

```nginx
server {
    listen 443 ssl;
    server_name api.yourdomain.com;
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;           # SSE 必须关闭
        proxy_read_timeout 300s;      # 长连接超时
    }
}
```

## 项目结构

```
openclaw-router/
├── src/
│   ├── index.ts              # 入口
│   ├── app.ts                # Express 应用配置
│   ├── config.ts             # 环境变量
│   ├── types.ts              # 类型定义
│   ├── db/
│   │   ├── connection.ts      # SQLite 连接 (WAL 模式)
│   │   └── schema.sql        # 数据库 Schema
│   ├── middleware/
│   │   ├── auth.ts           # API Key 认证
│   │   ├── admin-auth.ts     # Admin JWT 认证
│   │   ├── rate-limit.ts     # 内存滑动窗口限流
│   │   └── error-handler.ts  # 全局错误处理
│   ├── providers/
│   │   ├── base.ts           # 抽象 Provider 接口
│   │   ├── openai.ts         # OpenAI 适配器
│   │   ├── anthropic.ts      # Anthropic 适配器
│   │   ├── gemini.ts         # Gemini 适配器
│   │   ├── mistral.ts        # Mistral 适配器
│   │   ├── openai-compatible.ts  # 通用 OpenAI 兼容适配器
│   │   ├── registry.ts       # 提供商注册表
│   │   └── router.ts         # 路由解析与回退
│   ├── routes/
│   │   ├── v1/               # OpenAI 兼容 API
│   │   ├── admin/            # 管理接口
│   │   └── user/             # 用户接口
│   ├── services/
│   │   ├── billing.ts        # 余额与计费
│   │   ├── key-manager.ts    # API Key 生成/验证
│   │   ├── token-counter.ts  # Token 估算
│   │   └── usage-logger.ts   # 异步用量日志
│   └── dashboard/
│       ├── index.html        # 管理面板 SPA
│       └── dashboard.ts      # 静态文件路由
├── scripts/
│   └── seed.ts              # 数据初始化
├── Dockerfile
├── docker-compose.yml
├── ecosystem.config.cjs     # PM2 配置
└── nginx.conf.example       # Nginx 配置示例
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 运行时 | Node.js + TypeScript |
| Web 框架 | Express |
| 数据库 | SQLite (better-sqlite3, WAL 模式) |
| 管理面板 | 纯 HTML/CSS/JS (无构建步骤) |
| 图表 | Chart.js |
| 日志 | Pino |
| 验证 | Zod |
| 部署 | PM2 / Docker |

## License

MIT
