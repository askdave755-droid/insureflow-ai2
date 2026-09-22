/**
 * Apollo reply webhook receiver.
 *
 * Core Apollo does not expose a native push webhook for sequence replies.
 * Point an Apollo automation / Zapier / Make webhook here with the contact ID
 * or email in the payload. Secured with APOLLO_WEBHOOK_SECRET via ?secret=...
 * or the x-apollo-secret header.
 */
const config = require('./config');
const { handleApolloReplyWebhook } = require('./lib/apolloNurture');

function attachApolloNurtureRoutes(app) {
  app.post('/webhook/apollo/replies', async (req, res) => {
    const providedSecret = req.query.secret || req.headers['x-apollo-secret'];
    if (config.APOLLO_WEBHOOK_SECRET && providedSecret !== config.APOLLO_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }
    try {
      const result = await handleApolloReplyWebhook(req.body);
      res.json({ received: true, ...result });
    } catch (error) {
      console.error('❌ Apollo reply webhook error:', error);
      // Webhook receivers should ACK bad payloads so the sender does not retry
      // forever; the error is in logs for diagnosis.
      res.status(200).json({ received: true, error: error.message });
    }
  });
}

module.exports = { attachApolloNurtureRoutes };
