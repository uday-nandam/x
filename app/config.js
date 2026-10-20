// Defaults used until you pick something from the on-screen menu (OK button).
// Choices made on the TV are remembered and win over these values.
window.RR_CONFIG = {
  airport: "IAD",      // IATA code
  radiusNm: 40,        // map half-height in nautical miles
  pollSeconds: 5,      // how often to refresh traffic
  proxy: ""            // optional CORS proxy prefix, e.g. "https://my-worker.example.workers.dev/?url="
};
