const app = require('../server.js');
const { connectDB, initializeDatabase } = require('../database.js');

module.exports = async (req, res) => {
    // Ensure the database connection is resolved before handing off to Express
    await connectDB();
    await initializeDatabase();
    
    // Hand the request to Express
    return app(req, res);
};
