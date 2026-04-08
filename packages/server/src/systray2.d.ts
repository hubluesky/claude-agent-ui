declare module 'systray2' {
  interface MenuItem {
    title: string
    tooltip: string
    checked: boolean
    enabled: boolean
    hidden?: boolean
    items?: MenuItem[]
  }
  interface MenuConfig {
    icon: string
    isTemplateIcon?: boolean
    title: string
    tooltip: string
    items: MenuItem[]
  }
  interface ClickAction {
    seq_id: number
    item: MenuItem
  }
  interface SysTrayOptions {
    menu: MenuConfig
    debug?: boolean
    copyDir?: boolean
  }
  class SysTray {
    constructor(options: SysTrayOptions)
    onClick(callback: (action: ClickAction) => void): void
    sendAction(action: { type: string; item: MenuItem; seq_id: number }): void
    kill(exitProcess?: boolean): void
    ready(): Promise<void>
    static separator: MenuItem
  }
  export default SysTray
}
