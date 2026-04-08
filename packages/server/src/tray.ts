import SysTray from 'systray2'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadIcon(): string {
  // 尝试加载图标，支持 .ico (Windows) 和 .png (macOS/Linux)
  const ext = process.platform === 'win32' ? 'ico' : 'png'
  const paths = [
    join(__dirname, '..', 'assets', `icon.${ext}`),
    join(__dirname, '..', 'assets', 'icon.png'), // fallback
  ]
  for (const p of paths) {
    try {
      return readFileSync(p).toString('base64')
    } catch { /* continue */ }
  }
  return ''
}

interface TrayCallbacks {
  onOpenBrowser: () => void
  onRestart: () => void
  onResetPassword: () => void
  onQuit: () => void
}

const SEQ_STATUS = 0
const SEQ_OPEN = 2
const SEQ_RESTART = 4
const SEQ_RESET_PASSWORD = 6
const SEQ_QUIT = 8

export function createTray(port: number, callbacks: TrayCallbacks): SysTray {
  const systray = new SysTray({
    menu: {
      icon: loadIcon(),
      isTemplateIcon: process.platform === 'darwin',
      title: '',
      tooltip: `Claude Agent UI — :${port}`,
      items: [
        { title: `● 运行中  :${port}`, tooltip: '', checked: false, enabled: false },
        SysTray.separator,
        { title: '在浏览器中打开', tooltip: '打开管理面板', checked: false, enabled: true },
        SysTray.separator,
        { title: '重启服务器', tooltip: '重启 Fastify', checked: false, enabled: true },
        SysTray.separator,
        { title: '重置管理密码', tooltip: '清除管理面板密码', checked: false, enabled: true },
        SysTray.separator,
        { title: '退出', tooltip: '停止服务器并退出', checked: false, enabled: true },
      ],
    },
    debug: false,
    copyDir: true,
  })

  systray.onClick((action) => {
    switch (action.seq_id) {
      case SEQ_OPEN:
        callbacks.onOpenBrowser()
        break
      case SEQ_RESTART:
        callbacks.onRestart()
        break
      case SEQ_RESET_PASSWORD:
        callbacks.onResetPassword()
        break
      case SEQ_QUIT:
        callbacks.onQuit()
        break
    }
  })

  return systray
}

export function updateTrayStatus(systray: SysTray, status: 'running' | 'stopped', port: number): void {
  const title = status === 'running' ? `● 运行中  :${port}` : '○ 已停止'
  systray.sendAction({
    type: 'update-item',
    item: { title, tooltip: '', checked: false, enabled: false },
    seq_id: SEQ_STATUS,
  })
}
