/**
 * Quick interactive semantic search to validate the Pinecone index.
 *
 * Usage:
 *   tsx index.ts --query "ceva mai gros"
 *   tsx index.ts --query "sandale pentru fete" --top 10
 */

import type { Config } from './types.ts'
import { OpenAIClient } from './clients/openai.ts'
import { PineconeClient } from './clients/pinecone.ts'

export async function runQuery(config: Config, text: string, topK: number): Promise<void> {
  const openai = new OpenAIClient(config.openai)
  const pinecone = new PineconeClient(config.pinecone)

  console.log(`Query: "${text}"`)
  console.log(`Top K: ${topK}`)
  console.log()

  const startTime = Date.now()
  const vector = await openai.embed(text)
  const embedTime = Date.now() - startTime

  const searchStart = Date.now()
  const matches = await pinecone.query(vector, topK)
  const searchTime = Date.now() - searchStart

  console.log(`Embed: ${embedTime}ms · Search: ${searchTime}ms · Results: ${matches.length}`)
  console.log()

  if (matches.length === 0) {
    console.log('No matches.')

    return
  }

  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log('  #   score    name                                              price')
  console.log('═══════════════════════════════════════════════════════════════════════')
  for (const [i, m] of matches.entries()) {
    const meta = m.metadata || {}
    const rank = String(i + 1).padStart(2)
    const score = (m.score * 100).toFixed(1).padStart(5) + '%'
    const name = String(meta.name || '(no name)').slice(0, 48).padEnd(48)
    const price = `${meta.price ?? 0} RON`.padStart(12)

    console.log(`  ${rank}  ${score}   ${name}  ${price}`)
  }
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log()
  console.log('Hint: scores above 0.4 are usually meaningful, above 0.5 are strong matches.')
}
