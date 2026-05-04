/**
 * GET /_v/acg/config
 *
 * Returns the ClientConfig for the current account.
 * Widget fetches this on mount to render greeting, starter chips, strings, brand colors.
 */

import { loadConfigForAccount } from '../config/load'

export async function getConfig(ctx: Context) {
  const account = ctx.vtex.account || ''
  const config = loadConfigForAccount(account)

  ctx.set('Cache-Control', 'public, max-age=300')
  ctx.body = config
}
