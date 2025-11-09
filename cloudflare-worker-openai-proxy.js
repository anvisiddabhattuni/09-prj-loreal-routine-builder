/* Cloudflare Worker: OpenAI proxy

Deploy this Worker and bind a secret named OPENAI_API_KEY (via wrangler or dashboard).
It accepts POST requests from the browser and forwards them to OpenAI, injecting the
server-side API key so it never appears in client JavaScript.

Security: Only deploy this worker when you control its usage. For public sites you
may want to add simple rate-limiting or restrict origins.

To deploy with Wrangler preview:
  1. Add this file to your project.
  2. In wrangler.toml, add a [[kv_namespaces]] or appropriate bindings and
     in the Cloudflare dashboard add a secret binding named OPENAI_API_KEY.
  3. Publish with `wrangler publish`.

Note: This is a minimal example. Adjust logging, error handling, and any
rate-limiting for production use.
*/

addEventListener("fetch", (event) => {
  event.respondWith(handle(event.request, event));
});

async function handle(request, event) {
  const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Only POST supported" }), {
      status: 405,
      headers: Object.assign(
        { "Content-Type": "application/json" },
        CORS_HEADERS
      ),
    });
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: Object.assign(
        { "Content-Type": "application/json" },
        CORS_HEADERS
      ),
    });
  }

  // Forward request to OpenAI (server-side secret should be bound as OPENAI_API_KEY)
  // The secret should be bound in the worker's environment as OPENAI_API_KEY.
  const OPENAI_KEY =
    typeof OPENAI_API_KEY !== "undefined" ? OPENAI_API_KEY : null;

  if (!OPENAI_KEY) {
    return new Response(
      JSON.stringify({ error: "OpenAI API key not configured on the worker" }),
      {
        status: 500,
        headers: Object.assign(
          { "Content-Type": "application/json" },
          CORS_HEADERS
        ),
      }
    );
  }

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify(body),
    });

    const text = await resp.text();
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      CORS_HEADERS
    );
    return new Response(text, { status: resp.status, headers });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Upstream request failed", detail: String(err) }),
      {
        status: 502,
        headers: Object.assign(
          { "Content-Type": "application/json" },
          CORS_HEADERS
        ),
      }
    );
  }
}
