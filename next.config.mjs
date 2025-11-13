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
}

export default nextConfig
