const STYLE_ID = 'claude-embed-styles'

const CSS = `
.claude-embed-root {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.claude-embed-panel {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  background: #1e1e1e;
  border-right: 1px solid #333;
}
.claude-embed-panel iframe {
  flex: 1;
  border: none;
  width: 100%;
}
.claude-embed-panel.collapsed {
  display: none;
}
.claude-embed-divider {
  position: relative;
  width: 5px;
  cursor: col-resize;
  background: #333;
  flex-shrink: 0;
}
.claude-embed-divider:hover,
.claude-embed-divider.dragging {
  background: #0078d4;
}
.claude-embed-divider.collapsed {
  width: 0;
  cursor: default;
}
.claude-embed-toggle {
  position: absolute;
  right: -14px;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 80px;
  background: rgba(51,51,51,0.5);
  border: none;
  border-radius: 0 4px 4px 0;
  cursor: pointer;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #aaa;
  font-size: 10px;
  padding: 0;
}
.claude-embed-toggle:hover {
  background: rgba(0,120,212,0.7);
  color: #fff;
}
.claude-embed-slot {
  flex: 1;
  min-width: 0;
  overflow: auto;
}
`

export function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

export function removeStyles(): void {
  document.getElementById(STYLE_ID)?.remove()
}
