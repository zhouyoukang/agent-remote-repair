import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '机械革命14+ 诊断中枢',
  description: '笔记本开机自动关机 - 完整诊断与修复指南',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-[#0a0a0f] text-[#f0f0f5] antialiased">
        {children}
      </body>
    </html>
  )
}
