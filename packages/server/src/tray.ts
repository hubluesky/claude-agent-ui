import SysTrayModule from 'systray2'

// systray2 是 CJS 模块，ESM interop 可能把 default 包一层
const SysTray = (SysTrayModule as any).default ?? SysTrayModule
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadIcon(): string {
  // systray2 所有平台都支持 base64 PNG，统一用 icon.png
  const paths = [
    join(__dirname, '..', 'assets', 'icon.png'),
    join(__dirname, '..', '..', 'assets', 'icon.png'), // from dist/
  ]
  for (const p of paths) {
    try {
      return readFileSync(p).toString('base64')
    } catch { /* continue */ }
  }
  return ''
}

interface TrayCallbacks {
  onOpenUI: () => void
  onOpenAdmin: () => void
  onRestart: () => void
  onResetPassword: () => void
  onQuit: () => void
}

const SEQ_STATUS = 0
const SEQ_OPEN_UI = 2
const SEQ_OPEN_ADMIN = 3
const SEQ_RESTART = 5
const SEQ_RESET_PASSWORD = 7
const SEQ_QUIT = 9

export function createTray(port: number, callbacks: TrayCallbacks): InstanceType<typeof SysTray> {
  const systray = new SysTray({
    menu: {
      icon: loadIcon(),
      isTemplateIcon: process.platform === 'darwin',
      title: '',
      tooltip: `Claude Agent UI — :${port}`,
      items: [
        { title: `● 运行中  :${port}`, tooltip: '', checked: false, enabled: false },
        SysTray.separator,
        { title: '打开聊天界面', tooltip: '在浏览器中打开聊天 UI', checked: false, enabled: true },
        { title: '管理面板', tooltip: '打开服务器管理面板', checked: false, enabled: true },
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

  systray.onClick((action: { seq_id: number }) => {
    switch (action.seq_id) {
      case SEQ_OPEN_UI:
        callbacks.onOpenUI()
        break
      case SEQ_OPEN_ADMIN:
        callbacks.onOpenAdmin()
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

export function updateTrayStatus(systray: InstanceType<typeof SysTray>, status: 'running' | 'stopped', port: number): void {
  const title = status === 'running' ? `● 运行中  :${port}` : '○ 已停止'
  systray.sendAction({
    type: 'update-item',
    item: { title, tooltip: '', checked: false, enabled: false },
    seq_id: SEQ_STATUS,
  })
}
