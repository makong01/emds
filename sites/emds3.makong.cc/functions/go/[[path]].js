import redirects from "../../data/redirects.json";

export function onRequest(context) {
  const method = context.request.method;

  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" }
    });
  }

  const url = new URL(context.request.url);
  const slug = url.pathname.replace(/^\/go\//, "").replace(/\/+$/, "");

  if (!slug) {
    return new Response("Missing redirect key", { status: 400 });
  }

  const target = redirects[slug];

  if (!target) {
    return new Response(`Redirect target not found for slug: ${slug}`, {
      status: 404,
      headers: { "content-type": "text/plain; charset=UTF-8" }
    });
  }

  return Response.redirect(target, 302);
}