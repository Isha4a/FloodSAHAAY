const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authorization header missing or malformed' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const secret = process.env.JWT_SECRET || 'super_secret_floodsahaay_jwt_key_2026_dev';
    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (e) {
      decoded = jwt.verify(token, 'super_secret_limitflood_jwt_key_2026_dev');
    }
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

module.exports = authMiddleware;
