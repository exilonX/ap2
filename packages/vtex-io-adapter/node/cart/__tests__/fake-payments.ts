/**
 * FakePaymentsClient — in-memory test double for the PaymentsClient.
 *
 * Test-only: do NOT export from the package. Mirrors the public methods
 * the new headless-order AgentTools depend on
 * (`sendPayments`, `authorizeTransaction`).
 *
 * Default behaviour: sendPayments records the request and resolves with
 * an empty body; authorizeTransaction resolves with `status: 'approved'`
 * (matching the Cash / promissory path). Tests can override the status
 * per call via `setNextAuthorizationStatus`.
 */

import type {
  AuthorizationResponse,
  PaymentRequest,
} from '../../clients/checkout'

export interface SendPaymentsCall {
  transactionId: string
  orderId: string
  payments: PaymentRequest[]
}

export class FakePaymentsClient {
  public sendPaymentsCalls: SendPaymentsCall[] = []
  public authorizationCalls: Array<{
    transactionId: string
    orderId: string
  }> = []

  private nextStatus = 'approved'
  private nextSendError: Error | null = null
  private nextAuthorizeError: Error | null = null

  public setNextAuthorizationStatus(status: string): void {
    this.nextStatus = status
  }

  public failNextSendPayments(error: Error): void {
    this.nextSendError = error
  }

  public failNextAuthorize(error: Error): void {
    this.nextAuthorizeError = error
  }

  public async sendPayments(
    transactionId: string,
    orderId: string,
    payments: PaymentRequest[]
  ): Promise<unknown> {
    if (this.nextSendError) {
      const err = this.nextSendError

      this.nextSendError = null
      throw err
    }

    this.sendPaymentsCalls.push({ transactionId, orderId, payments })

    return {}
  }

  public async authorizeTransaction(
    transactionId: string,
    orderId: string,
    _options?: {
      callbackUrl?: string
      credentials?: { appKey: string; appToken: string }
    }
  ): Promise<AuthorizationResponse> {
    if (this.nextAuthorizeError) {
      const err = this.nextAuthorizeError

      this.nextAuthorizeError = null
      throw err
    }

    this.authorizationCalls.push({ transactionId, orderId })

    return {
      orderId,
      transactionId,
      status: this.nextStatus,
    }
  }
}
