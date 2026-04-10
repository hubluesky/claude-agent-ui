import { createInterface } from 'readline'
import type { Readable, Writable } from 'stream'

/**
 * Parse NDJSON from a readable stream, yielding one parsed object per line.
 * Skips empty lines and logs parse errors without crashing.
 */
export async function* parseNdjson(stream: Readable): AsyncGenerator<unknown> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.trim()) continue
    try {
      yield JSON.parse(line)
    } catch {
      console.error('[NDJSON] Failed to parse line:', line.slice(0, 200))
    }
  }
}

/**
 * Write a JSON object as a single NDJSON line to a writable stream.
 * Returns false if the stream is not writable.
 */
export function writeNdjson(stream: Writable, obj: unknown): boolean {
  if (!stream.writable) return false
  stream.write(JSON.stringify(obj) + '\n')
  return true
}
