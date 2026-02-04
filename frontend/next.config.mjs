/** @type {import('next').NextConfig} */
const nextConfig = {
  // ✅ 启用错误显示（开发环境会显示悬浮错误指示器）
  // eslint: {
  //   ignoreDuringBuilds: true,
  // },
  // typescript: {
  //   ignoreBuildErrors: true,
  // },
  images: {
    unoptimized: true,
  },

  // FastAPI Backend Rewrites
  // 将 /api/backend/* 请求转发到 FastAPI 服务器
  // 配置方式：在 .env 中设置 NEXT_PUBLIC_BACKEND_HOST 和 NEXT_PUBLIC_BACKEND_PORT
  // NOTE: WebSocket 不支持 rewrites，使用直接连接（同样读取这两个环境变量）
  async rewrites() {
    const host = process.env.NEXT_PUBLIC_BACKEND_HOST || "127.0.0.1"
    const port = process.env.NEXT_PUBLIC_BACKEND_PORT || "8000"
    const fastApiUrl = `http://${host}:${port}`

    return [
      {
        source: "/api/backend/:path*",
        destination: `${fastApiUrl}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
