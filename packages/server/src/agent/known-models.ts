/**
 * Known Claude model definitions for the model selector.
 * The CLI doesn't expose available models via stream-json output,
 * so we maintain a curated list here.
 */

export interface KnownModel {
  value: string
  displayName: string
  description: string
  supportsAutoMode?: boolean
  supportedEffortLevels?: string[]
}

const KNOWN_MODELS: KnownModel[] = [
  {
    value: 'claude-opus-4-6',
    displayName: 'Opus 4.6 (1M context)',
    description: 'Most capable model with extended context',
    supportsAutoMode: true,
    supportedEffortLevels: ['low', 'medium', 'high'],
  },
  {
    value: 'claude-sonnet-4-6',
    displayName: 'Sonnet 4.6 (1M context)',
    description: 'Fast and capable with extended context',
    supportsAutoMode: true,
    supportedEffortLevels: ['low', 'medium', 'high'],
  },
  {
    value: 'claude-haiku-4-5-20251001',
    displayName: 'Haiku 4.5',
    description: 'Fastest and most compact',
    supportsAutoMode: false,
    supportedEffortLevels: ['low', 'medium', 'high'],
  },
]

export function getKnownModels(): KnownModel[] {
  return KNOWN_MODELS
}
