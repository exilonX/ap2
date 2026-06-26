/**
 * Profile loader.
 * Picks the right ClientConfig based on the VTEX account name.
 */

import type { ClientConfig } from './types'
import { defaultProfile } from './profiles/default'
import { miniprixProfile } from './profiles/miniprix'
import { vtexEuropeProfile } from './profiles/vtexeurope'
import { ivitebProfile } from './profiles/iviteb'
import { fstudioqaProfile } from './profiles/fstudioqa'

const PROFILES: ClientConfig[] = [
  vtexEuropeProfile,
  ivitebProfile,
  fstudioqaProfile,
  miniprixProfile,
  // Add new client profiles here.
  // The first one whose `accountMatches` includes the account wins.
]

/**
 * Load the ClientConfig for the current VTEX account.
 * Falls back to `defaultProfile` if no match.
 */
export function loadConfigForAccount(account: string): ClientConfig {
  const normalized = account.toLowerCase()

  for (const profile of PROFILES) {
    if (profile.accountMatches.some((m) => m.toLowerCase() === normalized)) {
      return profile
    }
  }

  return defaultProfile
}
