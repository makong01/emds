export async function onRequest(context) {
    const method = context.request.method;

    if (method !== "GET" && method !== "HEAD") {
        return new Response("Method Not Allowed", {
            status: 405,
            headers: { Allow: "GET, HEAD" }
        });
    }

    const url = new URL(context.request.url);
    const key = url.pathname.replace(/^\/assets\//, "").replace(/^\/+/, "");

    if (!key) {
        return new Response("Missing object key", { status: 400 });
    }

    const allowedPrefixes = ["images/"];
    const allowed = allowedPrefixes.some(prefix => key.startsWith(prefix));

    if (!allowed) {
        return new Response("Forbidden", { status: 403 });
    }

    const object = await context.env.MEDIA.get(key); // Bindings -> R2 bucket -> MEDIA 

    if (!object) {
        return new Response("Not Found", {
            status: 404,
            headers: {
                "Cache-Control": "public, max-age=60"
            }
        });
    }

    const headers = new Headers();

    object.writeHttpMetadata(headers);
    headers.set("ETag", object.httpEtag);
    headers.set("Cache-Control", "public, max-age=3600");
    headers.set("X-Content-Type-Options", "nosniff");

    if (method === "HEAD") {
        return new Response(null, { status: 200, headers });
    }

    return new Response(object.body, {
        status: 200,
        headers
    });
}