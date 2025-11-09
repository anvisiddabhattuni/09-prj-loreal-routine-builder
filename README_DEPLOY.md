# Deploy the Cloudflare Worker (image proxy)

This repository includes a Cloudflare Worker source file at `src/index.js` which implements a small image proxy endpoint:

- GET /image?src=<url> — fetches the remote image and returns it with permissive CORS headers.

Follow the steps below to deploy the worker to your Cloudflare account. I cannot deploy to your Cloudflare account from here because it requires your Cloudflare credentials/API token.

1. Install Wrangler (CLI)

```bash
# using npm (recommended for local use)
npm install -g wrangler
# or use npx to avoid global install:
# npx wrangler@latest --version
```

2. Configure `wrangler.toml`

Open `wrangler.toml` and replace `REPLACE_WITH_YOUR_ACCOUNT_ID` with your Cloudflare account id. Alternatively you can provide the account id inline when running deploy.

3. Create an API token

- In the Cloudflare dashboard create an API token with the following permissions:
  - Account: Workers Scripts: Edit
  - Zone: (none required for this worker-only usage)
  - Include the account if you prefer specific restrictions.

4. Set your API token locally (do NOT commit this token)

```bash
export CF_API_TOKEN="<YOUR_API_TOKEN>"
```

5. Deploy

If you updated `wrangler.toml` with `account_id`:

```bash
npx wrangler@latest deploy
```

If you prefer passing the account id on the command line:

```bash
npx wrangler@latest deploy --account-id <YOUR_ACCOUNT_ID>
```

6. Test the endpoint

Assuming your worker is deployed at `https://<your-worker-subdomain>.workers.dev`, test an image proxy with:

```bash
curl -I "https://<your-worker-subdomain>.workers.dev/image?src=https%3A%2F%2Fexample.com%2Fpath%2Fimage.jpg"
```

You should receive a 200 and an appropriate Content-Type header (e.g., image/png, image/jpeg). You can test a real product image URL (URL-encoded) from `products.json`.

7. Update `secrets.js`

Set `WORKER_BASE_URL` to your worker URL (no trailing slash), for example:

```javascript
const WORKER_BASE_URL = "https://<your-worker-subdomain>.workers.dev";
```

Then reload your front-end; `script.js` will rewrite product image URLs to use the worker proxy and images should show even if the original host blocks hotlinking or had CORS restrictions.

Security note

- Keep your OpenAI API key server-side (for example, in the worker) instead of committing it to `secrets.js`. If you want, I can help move the OpenAI call into the worker to keep the key secret.
