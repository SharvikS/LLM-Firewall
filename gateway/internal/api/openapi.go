package api

import (
	_ "embed"
	"net/http"
)

// openapiSpec is the OpenAPI 3.0 description of the gateway API, embedded at
// build time so the binary serves its own contract with no external files.
//
//go:embed openapi.json
var openapiSpec []byte

// OpenAPISpecHandler serves the raw OpenAPI document. It is mounted on a public
// path (no admin token) so tooling and the Swagger UI can fetch the contract;
// the spec describes the API surface but exposes no secrets.
func OpenAPISpecHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Cache-Control", "public, max-age=300")
	_, _ = w.Write(openapiSpec)
}

// SwaggerUIHandler serves a self-contained Swagger UI page that loads the spec
// from /openapi.json. The UI assets are pulled from the jsDelivr CDN to keep the
// binary small; the page itself is static.
func SwaggerUIHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(swaggerUIHTML))
}

const swaggerUIHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>TITAN Gateway API — Reference</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"/>
  <style>
    body { margin: 0; background: #0b0f17; }
    .topbar { display: none; }
    #swagger-ui { max-width: 1100px; margin: 0 auto; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        url: "/openapi.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis],
        layout: "BaseLayout",
      });
    };
  </script>
</body>
</html>`
