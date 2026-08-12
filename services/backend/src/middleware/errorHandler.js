const isProduction = process.env.NODE_ENV === 'production';

/**
 * Returning err.message to the client leaked internals — a failed ban replied
 * with the raw Postgres text `insert or update on table "bans" violates foreign
 * key constraint "bans_identity_id_fkey"`, which hands out schema details.
 * Errors deliberately thrown by a route can still set `err.expose = true` (or a
 * 4xx `err.status`) to have their message shown.
 */
function errorHandler(err, req, res, next) {
  console.error(`[${req.method} ${req.originalUrl}]`, err);
  if (res.headersSent) return next(err);

  const status = Number(err.status || err.statusCode) || 500;
  const safeToShow = err.expose === true || (status >= 400 && status < 500);

  res.status(status).json({
    error: safeToShow || !isProduction ? err.message || 'Internal server error' : 'Internal server error',
  });
}

module.exports = { errorHandler };
