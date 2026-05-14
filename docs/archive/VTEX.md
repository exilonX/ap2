
Steps required to have Agentic commerce and AP2 available for VTEX stores. 
Focus was mainly on the human present scenario and wallet type payment methods like GooglePay / PayPal (which also seem to have early adoption) 

1. Implement MCP Server for VTEX API in order to enable interaction with ChatGPT/Gemini/Claude. Should basically make headless API's available, tool examples: searchProducts, checkInventory, pricingQuote, shippingQuote, createOrderForm/Cart, addItemToCart, setShippingAddress, setClientProfile, etc. Can be done in VTEX IO with a customApp, like a VTEX API proxy. The only problem is that VTEX response could be a bit token heavy, a lot of VTEX specific data, so we would need to conform to a vendor neutral schema that makes it easier for LLM to understand, so most likely we will need some data transformation. 

2. Implement Agent to Agent Layer - Merchant Agent in order to enable interaction with shopping agents.  Will use the MCP Server for ease of use when needed or VTEX API. Main responsibilities: session start/teardown, cart negotiation, creation & signing of Cart Mandate (required for AP2), Payment Mandate at authorization time, redirect handling for 3DS2 challenge, final order created and mandate verification (require for PSP and Audit)
A2A Actions in line with AP2 (listed in the capabilities of the agent, most likely not all just the required ones that I see):
   - searchProducts,  createCart, priceCart, shippingOptions -> delegate to MCP createOrderForm, etc
   - previewCart - propose cart with all details and prices + set an expiry 
   - createCartMandate - once the user agrees to the cart, we make the first step in the AP2 protocol. Before this step we should have a valid orderForm with products, shipping info, clientDetails and a paymentMethod, negotiated by the client with the ShopperAgent. So in the normal headeless checkout we would have called (add orderForm items, add clientProfile, add shipping). Creating the CartMandate requires the following:
               - Align with existing AP2 types
               - Call VTEX Add Payment Data with GooglePay payment token from the Shopper Agent. 
               - Call VTEX Place Order to lock the cart products and prices 
               - The shopper agent will ask the user for a payment method - let's say google pay and it will generate some paymentData token to be used later in the process. Similar to clicking pay with GooglePay. 
               - Each merchant should have a DID + keypair generated per environment. Public key available via jwks, maybe a did:web for 3rd parties to verify signatures (Audit, PSP fraud detection) 
               - Create a cart mandate JSON with required details (products, shipping, payment method info - GooglePay paymentData) - and canonicalize the JSON RFC 8785 to ensure signature stability. 
               - Create a hash of the canonicalized Cart Mandate JSON using the generated keypair and persist the artifact somewhere, masterdata. 
               - Return the cartMandate digest hash, expiration and key id of the signature key. 
    -  executePayment -  start the actual payment flow in VTEX given the paymentData from the ShopperAgent:
               - Should check the cartMandate for validity (if price has changed ?? or if the mandate expired )
               - Build a Payment Mandate using the paymentData, risk field info from the wallet (googlePay) according to the AP2 types and sign it with the merchant keys generated. Persist it because we will need it in the future to send it to PSP to avoid fraud and authenticate the agent in the PSP. 
               - Call Send payment information and create transaction 
               - Call VTEX GatewayCallback to start the payment flow
               - VTEX calls the connector to start the payment process. 
               - The payment connector flow is mostly unchanged just that it should be Agent Aware, I don't think we need a custom payment method, normal GooglePay should work. But it should add Agent metadata, payment mandate to the createPayment call in the PSP to pass fraud detection. (Not really supported yet by PSPs but will be in the future so until there just add it to custom metadata for traceability) 
               - In this step we could get a 3DS2 challenge, in which case we either return the paymentUrl to the shopperAgent to render the challenge or to redirect to a secure environment. 
               - Without challenge we return status: approved if all is good, which challenge undefined and forward the redirect url to the shopper agent. 
               - This action should be streamable (keep connection alive) when we have a challenge because we send the challengeURL the shopper agent will render or redirect then if all is good we should get back a response. To be investigate exactly could be also done based on PSP webhook status. Render success and cancel / authorize after we have webhook confirmation. 
   
Things to take into consideration:
Further payment flow will be handled using the regular PPP - authorization/capture/refunds/cancellation. 
We should make sure we have a common id to easily audit the transaction, most likely the transactionId, acros A2A, MCP, VTEX, PSP. 
If for some reason the payment fails we should cancel the order to release stock.
Keep an evidence bundle with audit information about the transaction for disputes (Cart Mandate, Signatures, Digest, Payment Mandate) 
If the payment fails for some reason (insufficient funds) we should recreate only the PaymentMandate so just the execute payment step. If the payment method is changed, we should recreate the cartMandate - agent calling createCartMandate again. 
One important step will be Agent Discovery, so in order to make VTEX stores available to be queries the Agent Capabilities URL should be added to a list of trusted merchants. This is an important step and I'm not 100% sure how this would work, it's more business related I guess, but otherwise the merchant wouldn't have visibility, it's kinda like having good SEO for your website. 

The Human not Present scenario will on top of all of this have a IntentMandate (created by the Shopper Agent apparently and attached to the cartMandate)   which describes the rules for the agent to follow when making the purchase but I feel that this scenarios will have later adoption and we should focus on human present first as most of the flow is common, something like subscriptions on top of normal payments. 

I would say that building an MVP is possible at the moment and given the MCP VTEX Server would be already done the amount of work is not that huge, so doable in a couple of weeks. 

