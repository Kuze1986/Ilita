function authenticate(req, res, next) {
  const key = req.headers['x-internal-key'];

  if (!key || key !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}

module.exports = { authenticate };
