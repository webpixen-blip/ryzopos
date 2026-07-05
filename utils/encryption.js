const crypto = require('crypto');

// Use an environment variable for the secret key, or fallback to a hardcoded string for development.
// For AES-256, the key length must be 32 bytes (256 bits).
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'shamod-pos-secret-encryption-key-32b'; 

// We use an empty or zeroed Initialization Vector (IV) for DETERMINISTIC encryption.
// This is required so we can query MongoDB using the encrypted email string.
// Note: This is less secure than random IVs but necessary for direct lookup queries.
const IV = Buffer.alloc(16, 0); 

function getValidKey() {
    // Ensure the key is exactly 32 bytes long
    return crypto.createHash('sha256').update(String(ENCRYPTION_KEY)).digest('base64').substr(0, 32);
}

function encrypt(text) {
    if (!text) return text;
    try {
        const key = getValidKey();
        const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key), IV);
        let encrypted = cipher.update(text);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        return encrypted.toString('hex');
    } catch (e) {
        console.error('Encryption failing', e);
        return text;
    }
}

function decrypt(text) {
    if (!text) return text;
    try {
        const key = getValidKey();
        const encryptedText = Buffer.from(text, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key), IV);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (e) {
        // If decryption fails (e.g. data is currently plaintext), return it as is.
        // This helps during data migration where some rows might not be encrypted yet.
        return text;
    }
}

module.exports = {
    encrypt,
    decrypt
};
