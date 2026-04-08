export interface EmbedOptions {
  /** Server URL (required). Example: 'http://localhost:4000' */
  serverUrl: string
  /** Project working directory path (required) */
  cwd: string
  /** Container: CSS selector string or HTMLElement (required) */
  container: string | HTMLElement
  /** Initial panel width in px. Default: 350 */
  width?: number
  /** Minimum panel width in px. Default: 200 */
  minWidth?: number
  /** Maximum panel width in px. Default: window.innerWidth / 2 */
  maxWidth?: number
  /** localStorage key prefix. Default: 'claude-embed' */
  storageKey?: string
}

export interface ClaudeEmbedAPI {
  init(options: EmbedOptions): Promise<void>
  destroy(): void
  collapse(): void
  expand(): void
  toggle(): void
}

declare global {
  interface Window {
    ClaudeEmbed: ClaudeEmbedAPI
  }
}
