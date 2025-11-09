addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

/**
 * Cloudflare Worker: simple search proxy using Bing Web Search API
 *
 * Usage: GET /search?q=your+query
 * Requires binding: BING_API_KEY (set as a secret in your worker environment)
 *
 * Returns JSON: { results: [ { id, name, snippet, url, displayUrl } ], raw: <bing raw> }
 */
async function handleRequest(request) {
  const url = new URL(request.url);
  if (url.pathname !== "/search") {
    return new Response("Not found", { status: 404 });
  }

  const q = url.searchParams.get("q") || "";
  if (!q) {
    return new Response(
      JSON.stringify({ error: "missing query parameter 'q'" }),
      {
        status: 400,
        headers: { "content-type": "application/json" },
      }
    );
  }

  const apiKey = BING_API_KEY || BING_SUBSCRIPTION_KEY || null;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "BING_API_KEY not configured" }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      }
    );
  }

  try {
    const endpoint = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(
      q
    )}&count=5`;
    const resp = await fetch(endpoint, {
      headers: { "Ocp-Apim-Subscription-Key": apiKey },
      method: "GET",
    });

    if (!resp.ok) {
      const txt = await resp.text();
      return new Response(
        JSON.stringify({ error: `Bing API error ${resp.status}`, body: txt }),
        {
          status: 502,
          headers: { "content-type": "application/json" },
        }
      );
    }

    const data = await resp.json();

    const webPages = (data.webPages && data.webPages.value) || [];
    const results = webPages.slice(0, 5).map((w, i) => ({
      id: i + 1,
      name: w.name,
      snippet: w.snippet,
      url: w.url,
      displayUrl: w.displayUrl || w.url,
    }));

    return new Response(JSON.stringify({ results, raw: data }), {
      status: 200,
      headers: {
        "content-type": "application/json;charset=utf-8",
        "access-control-allow-origin": "*",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
