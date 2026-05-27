# Meta App & WhatsApp Business Cloud API setup

This guide takes you from "no Meta App" to "the gateway can send and receive messages." It assumes you already have:

- A Meta Business Manager account with business verification approved
- A phone number you can dedicate to WhatsApp Business (must not be already used on the consumer WhatsApp app for the same identity)
- A payment method on file (Meta charges for conversations beyond the free tier)

## 1. Create a Meta Developer App

1. Go to <https://developers.facebook.com/apps/>.
2. **Create App** → type **Business** → give it any name.
3. Associate it with your verified Business Manager.

## 2. Add the WhatsApp product

1. In the App Dashboard sidebar → **Add Products** → choose **WhatsApp** → **Set Up**.
2. Select your Business Account (or create one). Note the **WABA ID** shown at the top of the page → put it in `WHATSAPP_WABA_ID`.
3. Under **API Setup**, you'll see your **Phone number ID** → put it in `WHATSAPP_PHONE_NUMBER_ID`.

## 3. Add and verify a phone number

If you need to add a new number (or migrate one from another BSP), do it under **WhatsApp → Phone Numbers → Add Phone Number**. Receive the SMS / call OTP and complete verification.

Note: Meta usually requires you to **disable two-step verification** on the source side before migrating a number from another provider. Re-enable it after the move.

## 4. Generate a long-lived access token

Short-lived test tokens expire in 24 hours and are not suitable for production. Use a **System User** token instead:

1. Open **Meta Business Manager** → <https://business.facebook.com/settings>
2. **Users → System Users → Add** (e.g., name `wa-gateway`).
3. Click the new user → **Add Assets** → select your WhatsApp app **and** your WABA. Grant **Full control** for both.
4. **Generate New Token** → select the app → set token expiry to **Never** → select scopes:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
   - `business_management`
5. Copy the token → put it in `WHATSAPP_ACCESS_TOKEN`.

**Treat this token like a password.** Anyone with it can send messages as your business.

## 5. Configure the webhook

The gateway listens for incoming messages at `POST /webhook/whatsapp-meta` and responds to the verification handshake at `GET /webhook/whatsapp-meta`.

In the App Dashboard → **WhatsApp → Configuration → Webhook**:

1. **Callback URL**: `https://your-domain.example.com/webhook/whatsapp-meta`
2. **Verify Token**: anything you choose. Put the exact same string in `WHATSAPP_VERIFY_TOKEN` in your `.env`.
3. Click **Verify and Save**. The gateway will respond to Meta's challenge using your verify token.
4. Under **Webhook Fields**, subscribe to **messages** (covers inbound messages + delivery statuses).

## 6. Get the App Secret

Meta signs every webhook POST with HMAC-SHA256. The gateway refuses any payload whose signature doesn't match.

1. App Dashboard → **Settings → Basic → App Secret** → **Show**.
2. Copy it → put it in `META_APP_SECRET`.

## 7. Test end-to-end

With the server running and the webhook configured, send a WhatsApp message **from a personal phone** to your business number. You should see:

- A `[Webhook]` log line in the gateway journal
- A new row in `contacts` and `conversations` tables
- A new row in `messages` with `direction='inbound'`

Then send one outbound:

```bash
curl -X POST https://your-domain.example.com/api/messages/send/text \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to":"+15555550100","body":"Hello from my self-hosted gateway"}'
```

The recipient should see the message arrive within seconds.

## 8. The 24-hour customer window

Meta only allows free-form text messages to users who have messaged you in the last 24 hours (the "customer service window"). Outside the window you must use a **template message**. The gateway exposes:

```
POST /api/messages/send/template
```

You must approve templates in the Meta Dashboard (**Message Templates → Create Template**) before you can send them. They take 1–48 hours to be approved.

## 9. Pricing notes

- Service conversations (replies to user-initiated chats within 24h) include 1000/month free.
- Business-initiated conversations (templates) cost per country, per category (Marketing / Utility / Authentication).
- See <https://developers.facebook.com/docs/whatsapp/pricing>.

## 10. Common pitfalls

| Problem | Fix |
|---|---|
| "Phone number not registered" | Run `POST {phone-number-id}/register` once via the Meta API, with PIN if 2FA is on |
| Webhook verification fails | The token in `.env` must match the Meta Dashboard exactly, including whitespace |
| Messages stuck at `status='sent'` | Webhook URL not reachable from the public internet, or HTTPS cert invalid |
| Template message fails with "language" error | Use the exact language code as defined in the template (e.g., `fr` vs `fr_FR`) |
| Token expires unexpectedly | You used a user token, not a System User token. Regenerate per §4 |
