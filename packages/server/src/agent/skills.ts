import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { SlashCommandInfo } from '@claude-agent-ui/shared'

interface EnabledPlugins {
  [key: string]: boolean
}

/**
 * Scan ~/.claude/plugins/cache for SKILL.md files from enabled plugins.
 * Returns skills with prefixed names like "superpowers:brainstorming".
 */
export function scanSkills(): SlashCommandInfo[] {
  const claudeDir = join(homedir(), '.claude')
  const settingsPath = join(claudeDir, 'settings.json')
  const cacheDir = join(claudeDir, 'plugins', 'cache')

  if (!existsSync(cacheDir)) return []

  // Read enabled plugins from settings
  let enabledPlugins: EnabledPlugins = {}
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    enabledPlugins = settings.enabledPlugins ?? {}
  } catch {
    return []
  }

  const skills: SlashCommandInfo[] = []

  for (const [pluginKey, enabled] of Object.entries(enabledPlugins)) {
    if (!enabled) continue

    // pluginKey format: "name@marketplace" e.g. "superpowers@claude-plugins-official"
    const [pluginName, marketplace] = pluginKey.split('@')
    if (!pluginName || !marketplace) continue

    const marketplaceDir = join(cacheDir, marketplace)
    if (!existsSync(marketplaceDir)) continue

    // Find the plugin directory — could be directly named or nested
    const pluginDir = join(marketplaceDir, pluginName)
    if (!existsSync(pluginDir)) continue

    // Find the latest version directory that has skills
    const skillFiles = findSkillFiles(pluginDir)

    for (const { skillName, filePath } of skillFiles) {
      const info = parseSkillFrontmatter(filePath)
      if (info) {
        // Prefix with plugin name: "superpowers:brainstorming"
        const fullName = `${pluginName}:${info.name || skillName}`
        skills.push({
          name: fullName,
          description: info.description ?? '',
        })
      }
    }
  }

  return skills
}

interface SkillFileInfo {
  skillName: string
  filePath: string
}

function findSkillFiles(pluginDir: string): SkillFileInfo[] {
  const results: SkillFileInfo[] = []
  const seen = new Set<string>()

  try {
    // Look for versioned directories (e.g., "5.0.6") or "latest"
    const entries = readdirSync(pluginDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      // Check for skills/ subdirectory directly or inside version dirs
      const possibleSkillsDirs = [
        join(pluginDir, entry.name, 'skills'),
        join(pluginDir, entry.name),
      ]

      for (const skillsDir of possibleSkillsDirs) {
        if (!existsSync(skillsDir)) continue

        try {
          const skillEntries = readdirSync(skillsDir, { withFileTypes: true })
          for (const skillEntry of skillEntries) {
            if (!skillEntry.isDirectory()) continue
            const skillMd = join(skillsDir, skillEntry.name, 'SKILL.md')
            if (existsSync(skillMd) && !seen.has(skillEntry.name)) {
              seen.add(skillEntry.name)
              results.push({ skillName: skillEntry.name, filePath: skillMd })
            }
          }
        } catch { /* skip unreadable dirs */ }
      }
    }
  } catch { /* skip unreadable plugin dir */ }

  return results
}

function parseSkillFrontmatter(filePath: string): { name?: string; description?: string } | null {
  try {
    const content = readFileSync(filePath, 'utf-8')
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
    if (!match) return null

    const frontmatter = match[1]
    const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '')
    const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '')

    return { name, description }
  } catch {
    return null
  }
}
