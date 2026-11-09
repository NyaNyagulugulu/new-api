// Free-tier sidecar: the Zen free tier only answers requests whose TLS/HTTP
// client fingerprint matches the official OpenCode CLI, which is a Bun binary.
// Go's crypto/tls cannot reproduce that handshake (every uTLS preset, Chrome /
// Safari / Firefox / iOS / Android, is refused with 429 FreeUsageLimitError),
// but Bun can, because the official CLI *is* Bun. So the keyless lane sends
// through this process instead of dialing the upstream from Go.
//
// The sidecar is a dumb forwarder: it copies the method, path, query, headers
// and body to the upstream verbatim and streams the response back. Request
// shaping, tool renaming and stream rewriting all stay in Go; this process only
// supplies the transport identity.

const port = Number(process.env.OPENCODE_SIDECAR_PORT || 0)
const upstream = process.env.OPENCODE_SIDECAR_UPSTREAM || "https://opencode.ai"
// The free tier is metered per egress address, and an address that has spent
// its daily allowance answers 429 until UTC midnight. An operator can point the
// sidecar at another egress; empty means dial the upstream directly.
const proxy = (process.env.OPENCODE_SIDECAR_PROXY || "").trim()

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  idleTimeout: 255,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/__health") return new Response("ok")

    const headers = {}
    for (const [name, value] of request.headers) {
      const key = name.toLowerCase()
      if (key === "host" || key === "connection" || key === "content-length") continue
      headers[name] = value
    }

    const hasBody = request.method !== "GET" && request.method !== "HEAD"
    const body = hasBody ? await request.arrayBuffer() : undefined

    let response
    try {
      response = await fetch(upstream + url.pathname + url.search, {
        method: request.method,
        headers,
        body,
        ...(proxy ? { proxy } : {}),
      })
    } catch (error) {
      return Response.json(
        { type: "error", error: { type: "sidecar_transport_error", message: String(error) } },
        { status: 502 },
      )
    }

    const out = {}
    for (const [name, value] of response.headers) {
      const key = name.toLowerCase()
      if (key === "content-encoding" || key === "transfer-encoding" || key === "connection") continue
      out[name] = value
    }
    return new Response(response.body, { status: response.status, headers: out })
  },
})

console.log(`READY ${server.port}`)
