const API_BASE = '/api/public/store';

let allProducts = [];
let storeWhatsappNumber = '';

document.addEventListener('DOMContentLoaded', async () => {
    // Determine the business name from the URL path
    const pathParts = window.location.pathname.split('/');
    // Get the last part of the path (business name). 
    let businessNameRaw = pathParts[pathParts.length - 1];

    // Decode URL properly to handle spaces (like User%20Store -> User Store)
    let businessName = decodeURIComponent(businessNameRaw);
    
    // If empty path somehow, just alert
    if (!businessName || businessName === '/') {
        showError('Invalid Store URL');
        return;
    }

    try {
        // fetch the encoded name
        const res = await fetch(`${API_BASE}/${encodeURIComponent(businessName)}`);
        
        if (!res.ok) {
            throw new Error('Store not found or marketplace is disabled');
        }
        
        const data = await res.json();
        
        // Update header
        document.title = `${data.business_name} - Marketplace`;
        document.getElementById('store-name').textContent = data.business_name;
        
        allProducts = data.products;
        storeWhatsappNumber = data.whatsapp_number || '94711234567'; // Fallback if old user
        
        document.getElementById('loading-spinner').style.display = 'none';
        
        renderProducts(allProducts);
        
    } catch (err) {
        showError(err.message);
    }
    
    // Setup Search
    document.getElementById('search-input').addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        const filtered = allProducts.filter(p => p.name.toLowerCase().includes(term));
        renderProducts(filtered);
    });
});

function renderProducts(products) {
    const grid = document.getElementById('products-grid');
    const noProducts = document.getElementById('no-products');
    
    grid.innerHTML = '';
    
    if (products.length === 0) {
        noProducts.style.display = 'block';
    } else {
        noProducts.style.display = 'none';
        
        products.forEach(p => {
            const formatCurrency = (amount) => {
                return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'LKR' }).format(amount).replace('LKR', 'Rs.');
            };

            const card = document.createElement('div');
            card.className = 'product-card';
            
            let imgHTML = '';
            if (p.image) {
                imgHTML = `<div class="product-image" style="background-image: url('${p.image}')"></div>`;
            } else {
                imgHTML = `<div class="product-image"><i class='bx bx-image'></i></div>`;
            }
            
            card.innerHTML = `
                ${imgHTML}
                <div class="product-details">
                    <div class="product-name">${p.name}</div>
                    <div class="product-price">${formatCurrency(p.price)}</div>
                </div>
            `;
            
            // Add WhatsApp click handler
            card.style.cursor = 'pointer';
            card.addEventListener('click', () => {
                const message = `Hi! I am interested in buying: ${p.name}`;
                const cleanPhone = storeWhatsappNumber.replace(/[^0-9]/g, '');
                const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
                window.open(whatsappUrl, '_blank');
            });
            
            grid.appendChild(card);
        });
    }
}

function showError(msg) {
    document.getElementById('loading-spinner').style.display = 'none';
    document.getElementById('store-name').textContent = 'Store Unavailable';
    
    const grid = document.getElementById('products-grid');
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--danger);">
        <i class='bx bx-error-circle' style="font-size: 64px; margin-bottom: 20px;"></i>
        <h2>${msg}</h2>
        <p>This store might not exist or the owner has disabled their marketplace.</p>
    </div>`;
}
