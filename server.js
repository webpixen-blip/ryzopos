const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const { encrypt } = require('./utils/encryption');
const { connectDB, initializeDatabase, User, Product, Invoice, Customer, StockLog } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to MongoDB when running locally
if (process.env.NODE_ENV !== 'production') {
    connectDB().then(() => {
        initializeDatabase();
    });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==== AUTH API ====

app.post('/api/auth/register', async (req, res) => {
    const { email, password, business_name, whatsapp_number } = req.body;
    if (!email || !password || !business_name || !whatsapp_number) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    try {
        const encryptedEmail = encrypt(email.toLowerCase());
        const existingUser = await User.findOne({ email: encryptedEmail }).collation({ locale: 'en', strength: 2 });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({ 
            email: email.toLowerCase(), // Mongoose setter will encrypt it
            password: hashedPassword, 
            business_name, 
            whatsapp_number 
        });
        res.status(201).json({ 
            token: user._id.toString(), 
            business_name: user.business_name, 
            role: user.role 
        });
    } catch (err) {
        console.error("Register Error:", err);
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const encryptedEmail = encrypt(email.toLowerCase());
        
        // Find using the encrypted email OR the legacy email
        const user = await User.findOne({ 
            $or: [
                { email: encryptedEmail },
                { email: email } // fallback for older entries
            ]
        });
        
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Verify Password
        const passwordMatch = await bcrypt.compare(password, user.password);
        
        // Fallback for unhashed default Admin password to allow first login securely
        const isLegacyAdmin = (user.role === 'admin' && user.password === 'Abc@12345' && password === 'Abc@12345');

        if (!passwordMatch && !isLegacyAdmin) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Force upgrade legacy plain-text admin password or emails on successful login
        if (isLegacyAdmin || user.email === email) {
            const newHashed = await bcrypt.hash(isLegacyAdmin ? 'Mynameis1234' : password, 10);
            await User.updateOne(
                { _id: user._id },
                { 
                    password: newHashed,
                    email: encrypt(email.toLowerCase())
                }
            );
        }

        res.json({ token: user._id.toString(), business_name: user.business_name, role: user.role });
    } catch (err) {
        console.error("Login Error:", err);
        return res.status(500).json({ error: err.message });
    }
});

// ==== AUTH MIDDLEWARE ====
const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
    
    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    
    try {
        const user = await User.findById(token);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });
        req.user = user;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
};

app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/auth') || req.path.startsWith('/public')) return next();
    return authMiddleware(req, res, next);
});

// ==== ADMIN API ====

const adminMiddleware = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Forbidden: Admins only' });
    }
};

const staffMiddleware = (req, res, next) => {
    if (req.user && (req.user.role === 'admin' || req.user.role === 'staff' || req.user.role === 'user')) {
        next();
    } else {
        res.status(403).json({ error: 'Forbidden' });
    }
};

app.get('/api/admin/users', adminMiddleware, async (req, res) => {
    try {
        const users = await User.find({ role: { $ne: 'admin' } }).select('-password');
        const mappedUsers = users.map(u => ({
            id: u._id.toString(),
            email: u.email, // Decrypted automatically by Mongoose getter
            business_name: u.business_name,
            whatsapp_number: u.whatsapp_number,
            marketplace_enabled: u.marketplace_enabled,
            role: u.role
        }));
        res.json(mappedUsers);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.put('/api/admin/users/:id', adminMiddleware, async (req, res) => {
    // Note: The Mongoose setter will handle encrypting the new email if supplied
    const { email, business_name, whatsapp_number, marketplace_enabled, password } = req.body;
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        
        if (email) user.email = email.toLowerCase();
        if (business_name) user.business_name = business_name;
        if (whatsapp_number) user.whatsapp_number = whatsapp_number;
        if (marketplace_enabled !== undefined) user.marketplace_enabled = marketplace_enabled;
        if (password) {
            user.password = await bcrypt.hash(password, 10);
        }
        
        await user.save(); // Using save() triggers getters/setters instead of findByIdAndUpdate
        
        res.json({ message: 'User updated successfully' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.delete('/api/admin/users/:id', adminMiddleware, async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await User.findByIdAndDelete(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        
        // Also delete associated products and invoices
        await Product.deleteMany({ user_id: userId });
        await Invoice.deleteMany({ user_id: userId });
        
        res.json({ message: 'User and all associated data deleted successfully' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ==== DASHBOARD API ====

app.get('/api/dashboard', async (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const currentMonth = today.slice(0, 7); // YYYY-MM
    
    // Admin query filter bypass
    const queryFilter = req.user.role === 'admin' ? {} : { user_id: req.user._id };
    
    try {
        // Daily Stats
        const dailyInvoices = await Invoice.find({ ...queryFilter, date: today });
        const totalBillsToday = dailyInvoices.length;
        const dailyIncome = dailyInvoices.reduce((sum, inv) => sum + inv.total_amount, 0);

        // Monthly Stats
        const monthlyInvoices = await Invoice.find({ ...queryFilter, date: new RegExp('^' + currentMonth) });
        const totalBillsMonth = monthlyInvoices.length;
        const monthlyIncome = monthlyInvoices.reduce((sum, inv) => sum + inv.total_amount, 0);

        // Product Stats
        const totalProducts = await Product.countDocuments(queryFilter);
        const lowStockProducts = await Product.countDocuments({ ...queryFilter, quantity: { $lte: 5 } });

        res.json({
            totalBillsToday,
            dailyIncome,
            totalBillsMonth,
            monthlyIncome,
            totalProducts,
            lowStockProducts
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get('/api/dashboard/low-stock', async (req, res) => {
    try {
        const queryFilter = req.user.role === 'admin' ? {} : { user_id: req.user._id };
        const products = await Product.find({ ...queryFilter, quantity: { $lte: 5 } })
            .populate('user_id', 'business_name')
            .sort({ quantity: 1 })
            .limit(10);
            
        const mappedProducts = products.map(p => ({
            id: p._id.toString(),
            name: p.name,
            quantity: p.quantity,
            price: p.price,
            owner_name: p.user_id ? p.user_id.business_name : 'Unknown'
        }));
        
        res.json(mappedProducts);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ==== INVENTORY (PRODUCTS) API ====

app.get('/api/products', async (req, res) => {
    try {
        const queryFilter = req.user.role === 'admin' ? {} : { user_id: req.user._id };
        const products = await Product.find(queryFilter)
            .populate('user_id', 'business_name')
            .sort({ name: 1 });
        
        // Map _id to id for the frontend
        const mappedProducts = products.map(p => ({
            id: p._id.toString(),
            name: p.name,
            quantity: p.quantity,
            price: p.price,
            cost_price: p.cost_price,
            barcode: p.barcode,
            expiry_date: p.expiry_date,
            image: p.image,
            owner_name: p.user_id ? p.user_id.business_name : 'Unknown'
        }));
        
        res.json(mappedProducts);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/products', async (req, res) => {
    const { name, quantity, price, cost_price, barcode, expiry_date, image } = req.body;
    if (!name || quantity === undefined || price === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    try {
        const product = await Product.create({
            user_id: req.user._id,
            name,
            quantity,
            price,
            cost_price,
            barcode,
            expiry_date,
            image
        });

        // Log initial stock as 'IN'
        if (quantity > 0) {
            await StockLog.create({
                user_id: req.user._id,
                product_id: product._id,
                product_name: name,
                action: 'IN',
                quantity: quantity
            });
        }

        res.status(201).json({ id: product._id.toString(), name, quantity, price, image });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.put('/api/products/:id', async (req, res) => {
    const { name, quantity, price, cost_price, barcode, expiry_date, image } = req.body;
    try {
        const queryFilter = req.user.role === 'admin' ? { _id: req.params.id } : { _id: req.params.id, user_id: req.user._id };
        
        // Find old product to compare quantity for logging
        const oldProduct = await Product.findOne(queryFilter);
        if (!oldProduct) return res.status(404).json({ error: 'Product not found' });

        const qtyDiff = quantity - oldProduct.quantity;
        
        const product = await Product.findOneAndUpdate(
            queryFilter,
            { name, quantity, price, cost_price, barcode, expiry_date, image },
            { new: true }
        );

        if (qtyDiff !== 0) {
            await StockLog.create({
                user_id: req.user._id,
                product_id: product._id,
                product_name: name || product.name,
                action: qtyDiff > 0 ? 'IN' : 'OUT',
                quantity: Math.abs(qtyDiff)
            });
        }

        res.json({ message: 'Product updated successfully' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.delete('/api/products/:id', async (req, res) => {
    try {
        const queryFilter = req.user.role === 'admin' ? { _id: req.params.id } : { _id: req.params.id, user_id: req.user._id };
        const product = await Product.findOneAndDelete(queryFilter);
        if (!product) return res.status(404).json({ error: 'Product not found' });
        res.json({ message: 'Product deleted successfully' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ==== INVOICES API ====

app.get('/api/invoices', async (req, res) => {
    const { date, month } = req.query;
    let query = req.user.role === 'admin' ? {} : { user_id: req.user._id };

    if (date) {
        query.date = date;
    } else if (month) {
        query.date = new RegExp('^' + month);
    }

    try {
        const invoices = await Invoice.find(query)
            .populate('user_id', 'business_name')
            .sort({ date: -1, time: -1 });
        
        // Map _id to id for frontend
        const mappedInvoices = invoices.map(inv => ({
            id: inv._id.toString(),
            invoice_number: inv.invoice_number,
            date: inv.date,
            time: inv.time,
            total_amount: inv.total_amount,
            owner_name: inv.user_id ? inv.user_id.business_name : 'Unknown'
        }));
        
        res.json(mappedInvoices);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get('/api/invoices/:id', async (req, res) => {
    try {
        const queryFilter = req.user.role === 'admin' ? { _id: req.params.id } : { _id: req.params.id, user_id: req.user._id };
        const invoice = await Invoice.findOne(queryFilter).populate('user_id', 'business_name');
        if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
        
        const response = {
            id: invoice._id.toString(),
            invoice_number: invoice.invoice_number,
            date: invoice.date,
            time: invoice.time,
            total_amount: invoice.total_amount,
            items: invoice.items.map(item => ({
                id: item._id ? item._id.toString() : null,
                product_name: item.product_name,
                quantity: item.quantity,
                price: item.price,
                subtotal: item.subtotal
            }))
        };
        res.json(response);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/invoices', async (req, res) => {
    const { items, total_amount, payment_method, discount_total, tax_vat, tax_nbt, customer_id } = req.body;
    if (!items || items.length === 0 || !total_amount) {
        return res.status(400).json({ error: 'Invalid invoice data' });
    }

    const today = new Date();
    const date = today.toISOString().split('T')[0];
    const time = today.toTimeString().split(' ')[0].substring(0, 5); // HH:MM
    const invoice_number = 'INV-' + today.getTime().toString().slice(-6);

    const formattedItems = items.map(item => ({
        product_name: item.name,
        quantity: item.quantity,
        price: item.price,
        discount: item.discount || 0,
        subtotal: (item.quantity * item.price) - (item.discount || 0)
    }));

    try {
        const invoice = await Invoice.create({
            user_id: req.user._id,
            invoice_number,
            date,
            time,
            total_amount,
            payment_method: payment_method || 'Cash',
            discount_total: discount_total || 0,
            tax_vat: tax_vat || 0,
            tax_nbt: tax_nbt || 0,
            customer_id: customer_id || null,
            items: formattedItems
        });
        
        // Update product stock and log outgoing stock
        for (const item of items) {
            const product = await Product.findOneAndUpdate(
                { name: item.name, user_id: req.user._id },
                { $inc: { quantity: -item.quantity } },
                { new: true }
            );

            await StockLog.create({
                user_id: req.user._id,
                product_id: product ? product._id : null,
                product_name: item.name,
                action: 'OUT',
                quantity: item.quantity
            });
        }

        // Update customer loyalty points (1 point per 100 Rs spent, for example)
        if (customer_id) {
            const pointsToAdd = Math.floor(total_amount / 100);
            await Customer.findByIdAndUpdate(customer_id, { $inc: { loyalty_points: pointsToAdd } });
        }

        res.status(201).json({ 
            message: 'Invoice created successfully',
            invoice: {
                id: invoice._id.toString(),
                invoice_number,
                date,
                time,
                total_amount,
                items: formattedItems
            }
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.delete('/api/invoices/:id', async (req, res) => {
    try {
        const queryFilter = req.user.role === 'admin' ? { _id: req.params.id } : { _id: req.params.id, user_id: req.user._id };
        const invoice = await Invoice.findOneAndDelete(queryFilter);
        if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
        
        // Need to add back the stock quantities
        if (invoice.user_id) {
            for (const item of invoice.items) {
                await Product.findOneAndUpdate(
                    { name: item.product_name, user_id: invoice.user_id },
                    { $inc: { quantity: item.quantity } }
                );
            }
        }
        res.json({ message: 'Invoice deleted successfully. Inventory restocked.' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ==== REPORTS API ====

app.get('/api/reports/sales', async (req, res) => {
    try {
        const queryMatch = req.user.role === 'admin' ? {} : { user_id: req.user._id };
        const result = await Invoice.aggregate([
            { $match: queryMatch },
            { $group: { _id: "$date", total_sales: { $sum: "$total_amount" } } },
            { $project: { date: "$_id", total_sales: 1, _id: 0 } },
            { $sort: { date: -1 } }
        ]);
        res.json(result);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ==== MARKETPLACE API ====

app.post('/api/marketplace/enable', async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.user._id, { marketplace_enabled: true });
        res.json({ message: 'Marketplace enabled successfully' });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get('/api/public/store/:business_name', async (req, res) => {
    try {
        const storeOwner = await User.findOne({ business_name: req.params.business_name });
        if (!storeOwner || storeOwner.marketplace_enabled !== true) {
            return res.status(404).json({ error: 'Store not found or marketplace is disabled' });
        }
        
        // Return products that have stock
        const products = await Product.find({ user_id: storeOwner._id, quantity: { $gt: 0 } }).sort({ name: 1 });
        const mappedProducts = products.map(p => ({
            id: p._id.toString(),
            name: p.name,
            price: p.price,
            image: p.image
        }));
        
        // Return store info and products
        res.json({
            business_name: storeOwner.business_name,
            whatsapp_number: storeOwner.whatsapp_number,
            products: mappedProducts
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ==== CRM API ====

app.get('/api/customers', async (req, res) => {
    try {
        const queryFilter = req.user.role === 'admin' ? {} : { user_id: req.user._id };
        const customers = await Customer.find(queryFilter).sort({ name: 1 });
        res.json(customers);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.post('/api/customers', async (req, res) => {
    const { name, phone } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Name and Phone are required' });
    
    try {
        const customer = await Customer.create({
            user_id: req.user._id,
            name,
            phone
        });
        res.status(201).json(customer);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ==== EXTENDED REPORTS API ====

app.get('/api/reports/stock-logs', async (req, res) => {
    try {
        const queryFilter = req.user.role === 'admin' ? {} : { user_id: req.user._id };
        const logs = await StockLog.find(queryFilter).sort({ timestamp: -1 }).limit(100);
        res.json(logs);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get('/api/reports/product-sales', async (req, res) => {
    try {
        const queryMatch = req.user.role === 'admin' ? {} : { user_id: req.user._id };
        const result = await Invoice.aggregate([
            { $match: queryMatch },
            { $unwind: "$items" },
            {
                $group: {
                    _id: "$items.product_name",
                    quantity_sold: { $sum: "$items.quantity" },
                    revenue: { $sum: "$items.subtotal" }
                }
            },
            {
                $project: {
                    product_name: "$_id",
                    quantity_sold: 1,
                    revenue: 1,
                    _id: 0
                }
            },
            { $sort: { quantity_sold: -1 } },
            { $limit: 10 }
        ]);
        console.log(`Product Sales Report for ${req.user.business_name}: ${result.length} items found`);
        res.json(result);
    } catch (err) {
        console.error('Product Sales Aggregation Error:', err);
        return res.status(500).json({ error: err.message });
    }
});

app.get('/api/reports/profit', async (req, res) => {
    try {
        const queryMatch = req.user.role === 'admin' ? {} : { user_id: req.user._id };
        
        // We need to match invoices, unwind items, then join with products to get cost_price
        // Or simpler: include current cost_price in InvoiceItem if we want historical accuracy.
        // For now, we'll use current cost_price from Product.
        
        const result = await Invoice.aggregate([
            { $match: queryMatch },
            { $unwind: "$items" },
            {
                $lookup: {
                    from: "products",
                    let: { prodName: "$items.product_name", userId: "$user_id" },
                    pipeline: [
                        { $match: { $expr: { $and: [ { $eq: ["$name", "$$prodName"] }, { $eq: ["$user_id", "$$userId"] } ] } } }
                    ],
                    as: "productInfo"
                }
            },
            { $unwind: "$productInfo" },
            {
                $group: {
                    _id: "$date",
                    revenue: { $sum: "$items.subtotal" },
                    cost: { $sum: { $multiply: ["$items.quantity", "$productInfo.cost_price"] } }
                }
            },
            {
                $project: {
                    date: "$_id",
                    revenue: 1,
                    cost: 1,
                    profit: { $subtract: ["$revenue", "$cost"] },
                    _id: 0
                }
            },
            { $sort: { date: -1 } }
        ]);
        
        res.json(result);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get('/api/reports/trends', async (req, res) => {
    try {
        const queryMatch = req.user.role === 'admin' ? {} : { user_id: req.user._id };
        const result = await Invoice.aggregate([
            { $match: queryMatch },
            {
                $group: {
                    _id: { $substr: ["$time", 0, 2] }, // Group by hour (HH)
                    sales_count: { $sum: 1 },
                    revenue: { $sum: "$total_amount" }
                }
            },
            {
                $project: {
                    hour: "$_id",
                    sales_count: 1,
                    revenue: 1,
                    _id: 0
                }
            },
            { $sort: { hour: 1 } }
        ]);
        console.log(`Sales Trends Report for ${req.user.business_name}: ${result.length} data points found`);
        res.json(result);
    } catch (err) {
        console.error('Trends Aggregation Error:', err);
        return res.status(500).json({ error: err.message });
    }
});

// Serves the public marketplace UI
app.get('/:business_name', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'marketplace.html'));
});

// Export app for Vercel, listen for local development
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}
module.exports = app;
