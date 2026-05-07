/**
 * Subset of W3C ContactAddress (PaymentRequest.shippingAddress).
 *
 * Mirrored from AP2 v0.2 Pydantic at:
 *   code/sdk/python/ap2/models/contact_picker.py
 *
 * Only the fields PaymentRequest/PaymentResponse actually reference are
 * modeled — full Contact Picker API is out of scope.
 */

export interface ContactAddress {
  city?: string;
  country?: string;
  dependent_locality?: string;
  organization?: string;
  phone?: string;
  postal_code?: string;
  recipient?: string;
  region?: string;
  sorting_code?: string;
  address_line?: string[];
}
