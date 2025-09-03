// Authorization JWT 

const jwt = require('jsonwebtoken');

const authenticate = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token){
        return res.status(401).json({message: 'Nie wykryto tokena'});
    }

    jwt.verify(token, process.env.JWT_SECRET, (error, user) => {
        if(error){
            return res.status(403).json({message: 'Token nie jest prawidłowy'});
            req.user = user;
            next();
        }
    });
};

module.exports = authenticate;