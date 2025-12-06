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
  async rewrites() {
    const fastApiUrl = process.env.NODE_ENV === "development"
      ? "http://127.0.0.1:8000"
      : process.env.FASTAPI_URL || "http://127.0.0.1:8000"

    return [
      {
        source: "/api/backend/:path*",
        destination: `${fastApiUrl}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
