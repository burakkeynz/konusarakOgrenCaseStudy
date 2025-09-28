const { createProxyMiddleware } = require("http-proxy-middleware");

module.exports = function (app) {
  const target = "http://localhost:5087";
  app.use(
    ["/health", "/auth", "/messages"],
    createProxyMiddleware({ target, changeOrigin: true })
  );
  app.use(
    "/hub",
    createProxyMiddleware({ target, changeOrigin: true, ws: true })
  );
};
