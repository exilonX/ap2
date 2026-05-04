/**
 * Quick interactive semantic search to validate the Pinecone index.
 *
 * Usage:
 *   tsx index.ts --query "ceva mai gros"
 *   tsx index.ts --query "sandale pentru fete" --top 10
 *   tsx index.ts --query "rochie elegantă" --on-sale
 */

import type { Config } from './types.ts'
import { OpenAIClient } from './clients/openai.ts'
import { PineconeClient } from './clients/pinecone.ts'

export interface QueryOptions {
  onSaleOnly?: boolean
}

export async function runQuery(
  config: Config,
  text: string,
  topK: number,
  options: QueryOptions = {}
): Promise<void> {
  const openai = new OpenAIClient(config.openai)
  const pinecone = new PineconeClient(config.pinecone)

  const filter = options.onSaleOnly ? { onSale: { $eq: true } } : undefined

  console.log(`Query: "${text}"`)
  console.log(`Top K: ${topK}${filter ? ' · filter: onSale=true' : ''}`)
  console.log()

  const startTime = Date.now()
  const vector = await openai.embed(text)
  const embedTime = Date.now() - startTime

  const searchStart = Date.now()
  const matches = await pinecone.query(vector, topK, filter)
  const searchTime = Date.now() - searchStart

  console.log(`Embed: ${embedTime}ms · Search: ${searchTime}ms · Results: ${matches.length}`)
  console.log()

  if (matches.length === 0) {
    console.log('No matches.')

    return
  }

  const sep = '═'.repeat(95)

  console.log(sep)
  console.log('  #   score    name                                              price        was      off  sale')
  console.log(sep)
  let onSaleCount = 0

  for (const [i, m] of matches.entries()) {
    const meta = m.metadata || {}
    const rank = String(i + 1).padStart(2)
    const score = (m.score * 100).toFixed(1).padStart(5) + '%'
    const name = String(meta.name || '(no name)').slice(0, 48).padEnd(48)
    const price = `${meta.price ?? 0} RON`.padStart(10)
    const onSale = Boolean(meta.onSale)
    const original = Number(meta.originalPrice ?? 0)
    const discountPct = Number(meta.discountPct ?? 0)
    const wasCol = original > 0 ? `${original} RON`.padStart(8) : '       -'
    const offCol = discountPct > 0 ? `${discountPct}%`.padStart(4) : '   -'
    const saleCol = onSale ? '✓' : ' '

    if (onSale) onSaleCount++

    console.log(`  ${rank}  ${score}   ${name}  ${price}  ${wasCol}  ${offCol}    ${saleCol}`)
  }
  console.log(sep)
  console.log()
  console.log(`On-sale in results: ${onSaleCount}/${matches.length}`)
  console.log('Hint: scores above 0.4 are usually meaningful, above 0.5 are strong matches.')
}
