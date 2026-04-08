import type { EmbedOptions } from './types'
import { injectStyles, removeStyles } from './styles'

/** djb2 hash → 8-char hex string */
function hashStr(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, '0')
}

interface PanelConfig {
  width: number
  collapsed: boolean
}

export class EmbedPanel {
  private opts: Required<Omit<EmbedOptions, 'container'>> & { container: HTMLElement }
  private root: HTMLDivElement | null = null
  private panel: HTMLDivElement | null = null
  private iframe: HTMLIFrameElement | null = null
  private divider: HTMLDivElement | null = null
  private toggleBtn: HTMLButtonElement | null = null
  private slot: HTMLDivElement | null = null
  private dragging = false
  private _collapsed = false
  private storageFullKey: string

  private onMouseMove: (e: MouseEvent) => void
  private onMouseUp: () => void

  constructor(options: EmbedOptions) {
    const container =
      typeof options.container === 'string'
        ? document.querySelector<HTMLElement>(options.container)
        : options.container
    if (!container) throw new Error(`ClaudeEmbed: container not found: ${options.container}`)

    this.opts = {
      serverUrl: options.serverUrl.replace(/\/$/, ''),
      cwd: options.cwd,
      container,
      width: options.width ?? 350,
      minWidth: options.minWidth ?? 200,
      maxWidth: options.maxWidth ?? Math.floor(window.innerWidth / 2),
      storageKey: options.storageKey ?? 'claude-embed',
    }
    this.storageFullKey = `${this.opts.storageKey}:${hashStr(this.opts.cwd)}`

    this.onMouseMove = this.handleMouseMove.bind(this)
    this.onMouseUp = this.handleMouseUp.bind(this)
  }

  /** Build DOM, load iframe, bind events */
  mount(): void {
    injectStyles()

    const { container } = this.opts
    const saved = this.loadConfig()

    // Root wrapper
    this.root = document.createElement('div')
    this.root.className = 'claude-embed-root'

    // Panel
    this.panel = document.createElement('div')
    this.panel.className = 'claude-embed-panel'
    this.panel.style.width = `${saved.width}px`

    // Iframe
    this.iframe = document.createElement('iframe')
    this.iframe.allow = 'clipboard-read; clipboard-write'
    this.iframe.src =
      `${this.opts.serverUrl}?embed=true&cwd=${encodeURIComponent(this.opts.cwd)}`

    // Hide panel until iframe loads to avoid white flash
    this.root.style.display = 'none'
    this.iframe.addEventListener('load', () => {
      if (this.root) this.root.style.display = ''
    })

    this.panel.appendChild(this.iframe)

    // Divider
    this.divider = document.createElement('div')
    this.divider.className = 'claude-embed-divider'

    // Toggle button
    this.toggleBtn = document.createElement('button')
    this.toggleBtn.className = 'claude-embed-toggle'
    this.toggleBtn.title = '收起/展开'
    this.toggleBtn.textContent = '◀'
    this.toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      this.toggle()
    })
    this.divider.appendChild(this.toggleBtn)

    // Slot for host's existing children
    this.slot = document.createElement('div')
    this.slot.className = 'claude-embed-slot'

    // Move container's existing children into slot
    while (container.firstChild) {
      this.slot.appendChild(container.firstChild)
    }

    // Assemble: root > panel + divider + slot
    this.root.appendChild(this.panel)
    this.root.appendChild(this.divider)
    this.root.appendChild(this.slot)
    container.appendChild(this.root)

    // Restore collapsed state
    if (saved.collapsed) {
      this._collapsed = true
      this.applyCollapsed()
    }

    // Resize events
    this.divider.addEventListener('mousedown', (e) => {
      e.preventDefault()
      this.dragging = true
      this.divider!.classList.add('dragging')
      document.body.style.cursor = 'col-resize'
      if (this.iframe) this.iframe.style.pointerEvents = 'none'
    })
    document.addEventListener('mousemove', this.onMouseMove)
    document.addEventListener('mouseup', this.onMouseUp)
  }

  /** Remove all SDK DOM and event listeners */
  destroy(): void {
    // Move slot children back to container
    if (this.slot && this.opts.container) {
      while (this.slot.firstChild) {
        this.opts.container.appendChild(this.slot.firstChild)
      }
    }
    // Remove root DOM
    this.root?.remove()
    // Remove document-level listeners
    document.removeEventListener('mousemove', this.onMouseMove)
    document.removeEventListener('mouseup', this.onMouseUp)
    // Remove styles
    removeStyles()
    // Reset refs
    this.root = this.panel = this.iframe = this.divider = this.toggleBtn = this.slot = null
  }

  collapse(): void {
    if (this._collapsed) return
    this._collapsed = true
    this.applyCollapsed()
    this.saveConfig()
  }

  expand(): void {
    if (!this._collapsed) return
    this._collapsed = false
    this.applyCollapsed()
    this.saveConfig()
  }

  toggle(): void {
    if (this._collapsed) this.expand()
    else this.collapse()
  }

  private applyCollapsed(): void {
    if (this._collapsed) {
      this.panel?.classList.add('collapsed')
      this.divider?.classList.add('collapsed')
      if (this.toggleBtn) this.toggleBtn.textContent = '▶'
    } else {
      this.panel?.classList.remove('collapsed')
      this.divider?.classList.remove('collapsed')
      if (this.toggleBtn) this.toggleBtn.textContent = '◀'
    }
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.dragging || !this.panel) return
    const w = Math.min(Math.max(e.clientX, this.opts.minWidth), this.opts.maxWidth)
    this.panel.style.width = `${w}px`
  }

  private handleMouseUp(): void {
    if (!this.dragging) return
    this.dragging = false
    this.divider?.classList.remove('dragging')
    document.body.style.cursor = ''
    if (this.iframe) this.iframe.style.pointerEvents = ''
    this.saveConfig()
  }

  private loadConfig(): PanelConfig {
    try {
      const raw = localStorage.getItem(this.storageFullKey)
      if (!raw) return { width: this.opts.width, collapsed: false }
      const parsed = JSON.parse(raw)
      return {
        width: typeof parsed.width === 'number' ? parsed.width : this.opts.width,
        collapsed: !!parsed.collapsed,
      }
    } catch {
      return { width: this.opts.width, collapsed: false }
    }
  }

  private saveConfig(): void {
    const width = this.panel ? parseInt(this.panel.style.width) || this.opts.width : this.opts.width
    localStorage.setItem(
      this.storageFullKey,
      JSON.stringify({ width, collapsed: this._collapsed }),
    )
  }
}
