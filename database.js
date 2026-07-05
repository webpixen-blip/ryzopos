const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { encrypt, decrypt } = require('./utils/encryption');

// Global variable to cache the mongoose connection
let cachedDb = null;

const connectDB = async () => {
    if (cachedDb) {
        console.log('Using cached MongoDB connection');
        return cachedDb;
    }

    try {
        const uri = process.env.MONGO_URI || 'mongodb+srv://shamod:Abc%4012345@cluster0.obj5rak.mongodb.net/?appName=Cluster0';
        const db = await mongoose.connect(uri, {
            serverSelectionTimeoutMS: 5000 // Tweak timeout down so Serverless fails faster instead of hanging
        });

        cachedDb = db;
        console.log('Connected to MongoDB database');
        return db;
    } catch (err) {
        console.error('Error connecting to MongoDB:', err.message);
        throw err; // don't process.exit(1) in serverless!
    }
};

// -- SCHEMAS --

const UserSchema = new mongoose.Schema({
    email: { 
        type: String, 
        required: true, 
        unique: true,
        set: (v) => v ? encrypt(v.toLowerCase()) : v,
        get: (v) => v ? decrypt(v) : v
    },
    password: { type: String, required: true },
    business_name: { type: String, required: true },
    whatsapp_number: { type: String },
    marketplace_enabled: { type: Boolean, default: false },
    role: { type: String, default: 'user' }
}, {
    toJSON: { getters: true },
    toObject: { getters: true }
});

// Since we'll hash passwords on registration and initial setup directly,
// we will avoid a pre-save hook to prevent double-hashing when updating users without changing passwords.

const ProductSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    quantity: { type: Number, default: 0 },
    price: { type: Number, default: 0.0 },
    cost_price: { type: Number, default: 0.0 }, // Added for profit calculation
    barcode: { type: String }, // Added for scanner integration
    expiry_date: { type: String }, // Added for tracking (YYYY-MM-DD)
    image: { type: String }
});

const InvoiceItemSchema = new mongoose.Schema({
    product_name: { type: String, required: true },
    quantity: { type: Number, required: true },
    price: { type: Number, required: true },
    discount: { type: Number, default: 0 }, // Item-wise discount
    subtotal: { type: Number, required: true }
});

const InvoiceSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    invoice_number: { type: String, required: true },
    date: { type: String, required: true }, // Format: YYYY-MM-DD
    time: { type: String, required: true }, // Format: HH:MM
    total_amount: { type: Number, default: 0.0 },
    payment_method: { type: String, default: 'Cash' }, // Cash, Card, QR, Credit
    discount_total: { type: Number, default: 0.0 },
    tax_vat: { type: Number, default: 0.0 },
    tax_nbt: { type: Number, default: 0.0 },
    customer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    items: [InvoiceItemSchema]
});

const CustomerSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    phone: { type: String, required: true },
    loyalty_points: { type: Number, default: 0 }
});

const StockLogSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    product_name: { type: String },
    action: { type: String, required: true }, // 'IN' or 'OUT'
    quantity: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now }
});

// -- MODELS --
const User = mongoose.model('User', UserSchema);
const Product = mongoose.model('Product', ProductSchema);
const Invoice = mongoose.model('Invoice', InvoiceSchema);
const Customer = mongoose.model('Customer', CustomerSchema);
const StockLog = mongoose.model('StockLog', StockLogSchema);

// Create default admin user
const initializeDatabase = async () => {
    try {
        const adminEmailObj = encrypt('admin'); // For lookup
        const adminExists = await User.findOne({ email: adminEmailObj }).collation({ locale: 'en', strength: 2 });
        
        // Also checks legacy unencrypted 'Admin' just in case
        const legacyAdmin = await User.findOne({ email: 'Admin' });

        if (!adminExists && !legacyAdmin) {
            const hashedPassword = await bcrypt.hash('Mynameis1234', 10);
            await User.create({
                email: 'admin', // The setter handles encryption and lowercasing
                password: hashedPassword,
                business_name: 'Admin Portal',
                role: 'admin'
            });
            console.log('Admin user created securely.');
        } else if (legacyAdmin && legacyAdmin.role !== 'admin') {
            await User.updateOne({ email: 'Admin' }, { role: 'admin' });
            console.log('Admin role updated for existing admin user.');
        }
    } catch (err) {
        console.error('Error initializing default user:', err.message);
    }
};

module.exports = {
    connectDB,
    initializeDatabase,
    User,
    Product,
    Invoice,
    Customer,
    StockLog
};
