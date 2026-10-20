// Defaults used until you pick something from the on-screen menu (OK button).
// Choices made on the TV are remembered and win over these values.
window.RR_CONFIG = {
  airport: "IAD",      // IATA code
  radiusNm: 40,        // map half-height in nautical miles
  pollSeconds: 5,      // how often to refresh traffic
  // Optional CORS proxy prefix. Served over http(s) by server.js this uses its built-in /proxy; the packaged TV app
  // (file://) goes direct. Example of an external one: "https://my-worker.example.workers.dev/?url="
  proxy: window.location.protocol.indexOf("http") === 0 ? "/proxy?url=" : ""
};
