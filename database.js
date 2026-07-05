const DB_URL = (process.env.FIREBASE_DATABASE_URL || 'https://eleveta-5ec70-default-rtdb.firebaseio.com').replace(/\/$/, '');

// Helper to make REST requests to Firebase Realtime Database
async function firebaseRequest(path, method = 'GET', body = null) {
    const url = `${DB_URL}/${path}.json`;
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json'
        }
    };
    if (body !== null) {
        options.body = JSON.stringify(body);
    }
    
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Firebase REST error: ${response.status} ${errText}`);
        }
        return await response.json();
    } catch (err) {
        console.error(`Error requesting Firebase at ${path}:`, err.message);
        throw err;
    }
}

// Global variable to cache the Firebase connection state
let dbConnected = false;

const connectDB = async () => {
    // With Firebase REST API, we are always connected
    if (!dbConnected) {
        console.log('Connected to Firebase Realtime Database');
        dbConnected = true;
    }
    return true;
};

// Generic Helpers for querying Firebase
async function findAll(path) {
    const data = await firebaseRequest(path);
    if (!data) return [];
    return Object.keys(data).map(key => ({
        id: key,
        _id: key,
        ...data[key]
    }));
}

async function find(path, filter = {}) {
    const all = await findAll(path);
    if (Object.keys(filter).length === 0) return all;
    return all.filter(item => {
        for (let key in filter) {
            const filterVal = filter[key];
            const itemVal = item[key];
            
            // Handle regular expression
            if (filterVal instanceof RegExp) {
                if (!filterVal.test(itemVal || '')) return false;
                continue;
            }
            
            // Handle MongoDB-like queries ($or, $ne, $lte, $gt)
            if (filterVal && typeof filterVal === 'object') {
                if (key === '$or') {
                    const matched = filterVal.some(subFilter => {
                        for (let k in subFilter) {
                            if (item[k] !== subFilter[k]) return false;
                        }
                        return true;
                    });
                    if (!matched) return false;
                    continue;
                }
                
                let match = true;
                if (filterVal.$ne !== undefined) {
                    match = match && (itemVal !== filterVal.$ne);
                }
                if (filterVal.$lte !== undefined) {
                    match = match && (itemVal <= filterVal.$lte);
                }
                if (filterVal.$gt !== undefined) {
                    match = match && (itemVal > filterVal.$gt);
                }
                if (!match) return false;
                continue;
            }
            
            // Default exact equality
            if (itemVal !== filterVal) return false;
        }
        return true;
    });
}

async function findOne(path, filter) {
    const list = await find(path, filter);
    return list[0] || null;
}

// Chainable query objects to emulate Mongoose method chaining
class QueryChain {
    constructor(promise) {
        this.promise = promise;
    }
    
    then(onFulfilled, onRejected) {
        return this.promise.then(onFulfilled, onRejected);
    }
    
    populate(path) {
        this.promise = this.promise.then(async (list) => {
            if (!Array.isArray(list)) {
                return await populateItem(list, path);
            }
            return await Promise.all(list.map(item => populateItem(item, path)));
        });
        return this;
    }
    
    sort(sortObj) {
        this.promise = this.promise.then((list) => {
            if (!Array.isArray(list)) return list;
            const key = Object.keys(sortObj)[0];
            const direction = sortObj[key];
            return [...list].sort((a, b) => {
                const valA = a[key] !== undefined ? a[key] : '';
                const valB = b[key] !== undefined ? b[key] : '';
                if (valA < valB) return direction === 1 ? -1 : 1;
                if (valA > valB) return direction === 1 ? 1 : -1;
                return 0;
            });
        });
        return this;
    }
    
    limit(n) {
        this.promise = this.promise.then((list) => {
            if (!Array.isArray(list)) return list;
            return list.slice(0, n);
        });
        return this;
    }
    
    select(fields) {
        if (fields && fields.includes('-password')) {
            this.promise = this.promise.then((list) => {
                if (!Array.isArray(list)) {
                    if (list) delete list.password;
                    return list;
                }
                return list.map(({ password, ...rest }) => rest);
            });
        }
        return this;
    }
}

class SingleQueryChain {
    constructor(promise) {
        this.promise = promise;
    }
    
    then(onFulfilled, onRejected) {
        return this.promise.then(onFulfilled, onRejected);
    }
    
    collation() {
        return this;
    }
    
    populate(path) {
        this.promise = this.promise.then(async (item) => {
            return await populateItem(item, path);
        });
        return this;
    }
}

async function populateItem(item, path) {
    if (!item) return null;
    if (path === 'user_id' && item.user_id) {
        const user = await User.findById(item.user_id);
        return {
            ...item,
            user_id: user ? { _id: user.id, business_name: user.business_name } : null
        };
    }
    return item;
}

// User Model Emulation
const User = {
    find: (filter = {}) => {
        return new QueryChain(find('users', filter));
    },
    findOne: (filter) => {
        return new SingleQueryChain(findOne('users', filter).then(makeSaveableUser));
    },
    findById: (id) => {
        return new SingleQueryChain(
            firebaseRequest(`users/${id}`).then(val => {
                if (!val) return null;
                return makeSaveableUser({ id, _id: id, ...val });
            })
        );
    },
    create: async (data) => {
        const res = await firebaseRequest('users', 'POST', {
            email: data.email,
            password: data.password,
            business_name: data.business_name,
            whatsapp_number: data.whatsapp_number || '',
            marketplace_enabled: data.marketplace_enabled || false,
            role: data.role || 'user'
        });
        return { id: res.name, _id: res.name, ...data };
    },
    updateOne: async (filter, updates) => {
        const item = await findOne('users', filter);
        if (item) {
            await firebaseRequest(`users/${item.id}`, 'PATCH', updates);
            return { nModified: 1 };
        }
        return { nModified: 0 };
    },
    findByIdAndUpdate: async (id, updates) => {
        await firebaseRequest(`users/${id}`, 'PATCH', updates);
        return { id };
    },
    findByIdAndDelete: async (id) => {
        await firebaseRequest(`users/${id}`, 'DELETE');
        return { id };
    }
};

function makeSaveableUser(item) {
    if (!item) return null;
    return {
        ...item,
        save: async function() {
            const dataToSave = { ...this };
            delete dataToSave.id;
            delete dataToSave._id;
            delete dataToSave.save;
            await firebaseRequest(`users/${this.id}`, 'PUT', dataToSave);
            return this;
        }
    };
}

// Product Model Emulation
const Product = {
    find: (filter = {}) => {
        return new QueryChain(find('products', filter));
    },
    findOne: (filter) => {
        return new SingleQueryChain(findOne('products', filter));
    },
    countDocuments: async (filter = {}) => {
        const list = await find('products', filter);
        return list.length;
    },
    create: async (data) => {
        const res = await firebaseRequest('products', 'POST', data);
        return { id: res.name, _id: res.name, ...data };
    },
    findOneAndUpdate: async (filter, updates, options = {}) => {
        const item = await findOne('products', filter);
        if (!item) return null;
        
        let finalUpdates = {};
        if (updates.$inc) {
            for (let key in updates.$inc) {
                finalUpdates[key] = (item[key] || 0) + updates.$inc[key];
            }
        } else {
            finalUpdates = { ...updates };
        }
        
        const merged = { ...item, ...finalUpdates };
        delete merged.id;
        delete merged._id;
        await firebaseRequest(`products/${item.id}`, 'PUT', merged);
        return { id: item.id, _id: item.id, ...merged };
    },
    findOneAndDelete: async (filter) => {
        const item = await findOne('products', filter);
        if (!item) return null;
        await firebaseRequest(`products/${item.id}`, 'DELETE');
        return item;
    },
    deleteMany: async (filter) => {
        const items = await find('products', filter);
        await Promise.all(items.map(item => firebaseRequest(`products/${item.id}`, 'DELETE')));
        return { deletedCount: items.length };
    }
};

// Invoice Model Emulation
const Invoice = {
    find: (filter = {}) => {
        return new QueryChain(find('invoices', filter));
    },
    findOne: (filter) => {
        return new SingleQueryChain(findOne('invoices', filter));
    },
    create: async (data) => {
        const res = await firebaseRequest('invoices', 'POST', data);
        return { id: res.name, _id: res.name, ...data };
    },
    findOneAndDelete: async (filter) => {
        const item = await findOne('invoices', filter);
        if (!item) return null;
        await firebaseRequest(`invoices/${item.id}`, 'DELETE');
        return item;
    },
    deleteMany: async (filter) => {
        const items = await find('invoices', filter);
        await Promise.all(items.map(item => firebaseRequest(`invoices/${item.id}`, 'DELETE')));
        return { deletedCount: items.length };
    }
};

// Customer Model Emulation
const Customer = {
    find: (filter = {}) => {
        return new QueryChain(find('customers', filter));
    },
    create: async (data) => {
        const res = await firebaseRequest('customers', 'POST', {
            user_id: data.user_id,
            name: data.name,
            phone: data.phone,
            loyalty_points: data.loyalty_points || 0
        });
        return { id: res.name, _id: res.name, ...data };
    },
    findByIdAndUpdate: async (id, updates) => {
        const item = await firebaseRequest(`customers/${id}`);
        if (!item) return null;
        
        let finalUpdates = {};
        if (updates.$inc) {
            for (let key in updates.$inc) {
                finalUpdates[key] = (item[key] || 0) + updates.$inc[key];
            }
        } else {
            finalUpdates = { ...updates };
        }
        
        await firebaseRequest(`customers/${id}`, 'PATCH', finalUpdates);
        return { id };
    }
};

// StockLog Model Emulation
const StockLog = {
    find: (filter = {}) => {
        return new QueryChain(find('stockLogs', filter));
    },
    create: async (data) => {
        const res = await firebaseRequest('stockLogs', 'POST', {
            user_id: data.user_id,
            product_id: data.product_id || null,
            product_name: data.product_name || '',
            action: data.action,
            quantity: data.quantity,
            timestamp: data.timestamp || new Date().toISOString()
        });
        return { id: res.name, _id: res.name, ...data };
    }
};

// Default setup function (creates default admin user if none exists)
const initializeDatabase = async () => {
    try {
        const { encrypt } = require('./utils/encryption');
        const bcrypt = require('bcryptjs');

        const adminEmailObj = encrypt('admin');
        const users = await find('users');
        
        const adminExists = users.find(u => u.email === adminEmailObj);
        const legacyAdmin = users.find(u => u.email === 'Admin');

        if (!adminExists && !legacyAdmin) {
            const hashedPassword = await bcrypt.hash('Mynameis1234', 10);
            await User.create({
                email: 'admin', // The setter in model didn't apply here since we emulate it. Let's encrypt it directly:
                email: encrypt('admin'),
                password: hashedPassword,
                business_name: 'Admin Portal',
                role: 'admin'
            });
            console.log('Admin user created securely in Firebase.');
        } else if (legacyAdmin && legacyAdmin.role !== 'admin') {
            await User.updateOne({ email: 'Admin' }, { role: 'admin' });
            console.log('Admin role updated for existing admin user in Firebase.');
        }
    } catch (err) {
        console.error('Error initializing default user in Firebase:', err.message);
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
