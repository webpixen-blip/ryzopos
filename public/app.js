const API_BASE = '/api';

let authToken = localStorage.getItem('pos_token') || null;
let currentBusiness = localStorage.getItem('pos_business') || '';
let currentRole = localStorage.getItem('pos_role') || 'user';

// ==== AUTH LOGIC ====
const authOverlay = document.getElementById('auth-overlay');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');

document.getElementById('switch-to-register').addEventListener('click', () => {
    loginForm.classList.remove('active');
    registerForm.classList.add('active');
    document.getElementById('auth-subtitle').textContent = "Register a new business";
});

document.getElementById('switch-to-login').addEventListener('click', () => {
    registerForm.classList.remove('active');
    loginForm.classList.add('active');
    document.getElementById('auth-subtitle').textContent = "Login to your account";
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    
    try {
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if(!res.ok) throw new Error(data.error || 'Login failed');
        
        loginSuccess(data.token, data.business_name, data.role);
    } catch(err) { alert(err.message); }
});

registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const business_name = document.getElementById('reg-businessName').value;
    const whatsapp_number = document.getElementById('reg-whatsapp').value;
    
    try {
        const res = await fetch(`${API_BASE}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, business_name, whatsapp_number })
        });
        const data = await res.json();
        if(!res.ok) throw new Error(data.error || 'Registration failed');
        
        loginSuccess(data.token, data.business_name, data.role);
    } catch(err) { alert(err.message); }
});

function loginSuccess(token, businessName, role = 'user') {
    authToken = token;
    currentBusiness = businessName;
    currentRole = role;
    localStorage.setItem('pos_token', token);
    localStorage.setItem('pos_business', businessName);
    localStorage.setItem('pos_role', role);
    checkAuth();
}

document.getElementById('btn-logout').addEventListener('click', () => {
    authToken = null;
    currentBusiness = '';
    currentRole = 'user';
    localStorage.removeItem('pos_token');
    localStorage.removeItem('pos_business');
    localStorage.removeItem('pos_role');
    checkAuth();
});

function checkAuth() {
    if (authToken) {
        authOverlay.classList.remove('active');
        document.getElementById('business-name-display').textContent = currentBusiness;
        
        if (currentRole === 'admin') {
            document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'block');
            document.getElementById('nav-item-admin').style.display = 'block';
        } else {
            document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
            document.getElementById('nav-item-admin').style.display = 'none';
        }
        
        // Re-initialize data
        loadDashboard();
    } else {
        authOverlay.classList.add('active');
    }
}

// Wrapper for fetch requests to include Auth Header
async function fetchAuth(url, options = {}) {
    const headers = options.headers ? { ...options.headers } : {};
    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }
    options.headers = headers;
    
    const res = await fetch(url, options);
    if (res.status === 401) {
        // Unauthorized, logout
        document.getElementById('btn-logout').click();
    }
    return res;
}

// ==== STATE ====
let products = [];
let customers = []; // Global customer list
let currentBill = [];
let currentPaymentMethod = 'Cash';
let currentTab = 'dashboard-view';
let chartInstance = null;
let currentProductImageBase64 = null;

// ==== DOM ELEMENTS ====
const clockEl = document.getElementById('clock');
const navLinks = document.querySelectorAll('.nav-link');
const views = document.querySelectorAll('.view');
const pageTitle = document.getElementById('page-title');
const modalOverlay = document.getElementById('modal-overlay');
const productModal = document.getElementById('product-modal');
const invoiceModal = document.getElementById('invoice-modal');
const adminUserModal = document.getElementById('admin-user-modal');
const customerModal = document.getElementById('customer-modal');

const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');

// ==== INITIALIZATION ====
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    updateClock();
    setInterval(updateClock, 1000);
    
    setupNavigation();
    setupModals();
    setupBarcodeScanner(); // Initialize scanner listener
    
    // Mobile sidebar toggle
    if (mobileMenuBtn && sidebar && sidebarOverlay) {
        mobileMenuBtn.addEventListener('click', () => {
            sidebar.classList.add('show-sidebar');
            sidebarOverlay.classList.add('active');
        });
        sidebarOverlay.addEventListener('click', () => {
            sidebar.classList.remove('show-sidebar');
            sidebarOverlay.classList.remove('active');
        });
    }

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').then((registration) => {
            console.log('Service Worker registered with scope:', registration.scope);
        }).catch((error) => {
            console.log('Service Worker registration failed:', error);
        });
    }
});

function updateClock() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' - ' + now.toLocaleDateString();
}

function setupNavigation() {
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            
            const target = link.getAttribute('data-target');
            views.forEach(view => view.classList.remove('active'));
            document.getElementById(target).classList.add('active');
            
            pageTitle.textContent = link.querySelector('.link-name').textContent;
            currentTab = target;
            
            // Close sidebar on mobile after navigation
            if (sidebarOverlay && sidebarOverlay.classList.contains('active')) {
                sidebar.classList.remove('show-sidebar');
                sidebarOverlay.classList.remove('active');
            }
            
            // Load specific view data
            if(target === 'dashboard-view') loadDashboard();
            if(target === 'inventory-view') loadInventory();
            if(target === 'pos-view') loadPOS();
            if(target === 'invoices-view') loadInvoices();
            if(target === 'reports-view') loadReports();
            if(target === 'admin-view') loadAdminUsers();
        });
    });
    
    // ==== MARKETPLACE ====
    const btnMarketplace = document.getElementById('btn-create-marketplace');
    if (btnMarketplace) {
        btnMarketplace.addEventListener('click', async () => {
            try {
                const res = await fetchAuth(`${API_BASE}/marketplace/enable`, { method: 'POST' });
                if (res.ok) {
                    const domain = window.location.origin;
                    const url = `${domain}/${encodeURIComponent(currentBusiness)}`;
                    // Open the marketplace URL in a new window immediately
                    window.open(url, '_blank');
                } else {
                    alert('Failed to enable marketplace. Make sure you have restarted your server.');
                }
            } catch (err) {
                console.error(err);
                alert('Error enabling marketplace. Did you restart the server?');
            }
        });
    }
}

function setupModals() {
    document.getElementById('btn-close-modal').addEventListener('click', hideModal);
    document.getElementById('btn-close-invoice-modal').addEventListener('click', hideModal);
    document.getElementById('btn-close-admin-modal').addEventListener('click', hideModal);
    document.getElementById('btn-close-customer-modal').addEventListener('click', hideModal);
    
    // Add product
    document.getElementById('btn-add-product').addEventListener('click', () => {
        document.getElementById('product-form').reset();
        document.getElementById('product-id').value = '';
        currentProductImageBase64 = null;
        document.getElementById('product-image-preview').innerHTML = '<span style="color:var(--text-muted);font-size:12px;">+ Add Image</span>';
        document.getElementById('product-modal-title').textContent = 'Add Product';
        showModal(productModal);
    });

    // Handle Image Selection
    document.getElementById('product-image').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = function(event) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 400;
                const MAX_HEIGHT = 400;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > MAX_WIDTH) {
                        height *= MAX_WIDTH / width;
                        width = MAX_WIDTH;
                    }
                } else {
                    if (height > MAX_HEIGHT) {
                        width *= MAX_HEIGHT / height;
                        height = MAX_HEIGHT;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                currentProductImageBase64 = dataUrl;
                document.getElementById('product-image-preview').innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;">`;
            }
            img.src = event.target.result;
        }
        reader.readAsDataURL(file);
    });

    // Handle Product Form
    document.getElementById('product-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('product-id').value;
        const name = document.getElementById('product-name').value;
        const qty = document.getElementById('product-qty').value;
        const price = document.getElementById('product-price').value;
        const costPrice = document.getElementById('product-cost-price').value;
        const barcode = document.getElementById('product-barcode').value;
        const expiryDate = document.getElementById('product-expiry').value;
        
        const payload = { 
            name, 
            quantity: parseInt(qty), 
            price: parseFloat(price),
            cost_price: parseFloat(costPrice) || 0,
            barcode: barcode || '',
            expiry_date: expiryDate || '',
            image: currentProductImageBase64
        };
        const method = id ? 'PUT' : 'POST';
        const url = id ? `${API_BASE}/products/${id}` : `${API_BASE}/products`;
        
        try {
            await fetchAuth(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            hideModal();
            loadInventory();
        } catch (err) {
            console.error(err);
            alert('Error saving product');
        }
    });

    // Print Receipt logic
    document.getElementById('btn-print-receipt').addEventListener('click', () => {
        window.print();
    });
    
    // Admin User Edit Form
    document.getElementById('admin-user-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('admin-user-id').value;
        const business_name = document.getElementById('admin-business-name').value;
        const email = document.getElementById('admin-email').value;
        const whatsapp_number = document.getElementById('admin-whatsapp').value;
        const password = document.getElementById('admin-password').value;
        const marketplace_enabled = document.getElementById('admin-marketplace-enabled').checked;
        
        const payload = { business_name, email, whatsapp_number, marketplace_enabled };
        if (password) {
            payload.password = password;
        }

        try {
            await fetchAuth(`${API_BASE}/admin/users/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            hideModal();
            loadAdminUsers();
        } catch (err) {
            console.error(err);
            alert('Error updating user');
        }
    });

    // Customer Form
    document.getElementById('customer-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('customer-name').value;
        const phone = document.getElementById('customer-phone').value;
        
        try {
            const res = await fetchAuth(`${API_BASE}/customers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, phone })
            });
            if (!res.ok) throw new Error('Failed to save customer');
            
            hideModal();
            loadCustomers(); // Reload customer list
        } catch (err) {
            console.error(err);
            alert('Error saving customer');
        }
    });

    document.getElementById('btn-add-customer').addEventListener('click', () => {
        document.getElementById('customer-form').reset();
        showModal(customerModal);
    });

    // Payment Method selection
    document.querySelectorAll('.pay-method').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.pay-method').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentPaymentMethod = btn.dataset.method;
        });
    });

    // Discount/Tax inputs trigger UI update
    document.getElementById('pos-discount').addEventListener('input', updateBillUI);
    document.getElementById('pos-tax-vat').addEventListener('input', updateBillUI);
}

function showModal(modal) {
    modalOverlay.classList.add('active');
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
    modal.classList.add('active');
}

function hideModal() {
    modalOverlay.classList.remove('active');
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
}

// ==== UTILS ====
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'LKR' }).format(amount).replace('LKR', 'Rs.');
}

function exportToCSV(filename, rows) {
    let processRow = function(row) {
        let finalVal = '';
        for (let j = 0; j < row.length; j++) {
            let innerValue = row[j] === null ? '' : row[j].toString();
            if (row[j] instanceof Date) { innerValue = row[j].toLocaleString(); }
            let result = innerValue.replace(/"/g, '""');
            if (result.search(/("|,|\n)/g) >= 0) result = '"' + result + '"';
            if (j > 0) finalVal += ',';
            finalVal += result;
        }
        return finalVal + '\n';
    };

    let csvFile = '';
    for (let i = 0; i < rows.length; i++) {
        csvFile += processRow(rows[i]);
    }

    let blob = new Blob([csvFile], { type: 'text/csv;charset=utf-8;' });
    let link = document.createElement("a");
    if (link.download !== undefined) {
        let url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

// ==== DASHBOARD ====
let bestSellersChart = null;
let salesTrendsChart = null;

async function loadDashboard() {
    if (!authToken) return;
    try {
        const res = await fetchAuth(`${API_BASE}/dashboard`);
        const stats = await res.json();
        
        document.getElementById('dash-bills-today').textContent = stats.totalBillsToday;
        document.getElementById('dash-income-today').textContent = formatCurrency(stats.dailyIncome);
        document.getElementById('dash-income-month').textContent = formatCurrency(stats.monthlyIncome);
        document.getElementById('dash-low-stock').textContent = stats.lowStockProducts;

        // Fetch Profits
        const resProfit = await fetchAuth(`${API_BASE}/reports/profit`);
        const profitData = await resProfit.json();
        const today = new Date().toISOString().split('T')[0];
        const currentMonth = today.slice(0, 7);
        
        const todayProfit = profitData.find(p => p.date === today)?.profit || 0;
        const monthProfit = profitData.filter(p => p.date.startsWith(currentMonth)).reduce((s, p) => s + p.profit, 0);
        
        document.getElementById('dash-profit-today').textContent = formatCurrency(todayProfit);
        document.getElementById('dash-profit-month').textContent = formatCurrency(monthProfit);

        // Load low stock table
        const resAlerts = await fetchAuth(`${API_BASE}/dashboard/low-stock`);
        const alerts = await resAlerts.json();
        const tbody = document.querySelector('#low-stock-table tbody');
        tbody.innerHTML = '';
        
        alerts.forEach(item => {
            const tr = document.createElement('tr');
            let nameHTML = `<td>${item.name}</td>`;
            if (currentRole === 'admin') {
                nameHTML = `<td>${item.name} <div style="font-size:11px;color:var(--primary);margin-top:2px;">[${item.owner_name}]</div></td>`;
            }
            
            tr.innerHTML = `
                ${nameHTML}
                <td class="text-danger">${item.quantity}</td>
                <td>${formatCurrency(item.price)}</td>
            `;
            tbody.appendChild(tr);
        });

        // Load Charts
        loadBestSellersChart();
        loadSalesTrendsChart();
    } catch (err) {
        console.error(err);
    }
}

async function loadBestSellersChart() {
    try {
        const res = await fetchAuth(`${API_BASE}/reports/product-sales`);
        const data = await res.json();
        const chartEl = document.getElementById('best-sellers-chart');
        if (!chartEl) return;
        const ctx = chartEl.getContext('2d');
        
        if (typeof Chart === 'undefined') {
            console.error('Chart.js is not loaded! Retrying in 1s...');
            setTimeout(loadBestSellersChart, 1000);
            return;
        }

        if (bestSellersChart) bestSellersChart.destroy();

        if (data.length === 0) {
            ctx.font = "14px Inter";
            ctx.fillStyle = "#64748b";
            ctx.textAlign = "center";
            ctx.fillText("No sales data available yet.", chartEl.width / 2, chartEl.height / 2);
            return;
        }
        
        const top5 = data.slice(0, 5);
        bestSellersChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: top5.map(d => d.product_name),
                datasets: [{
                    label: 'Quantity Sold',
                    data: top5.map(d => d.quantity_sold),
                    backgroundColor: '#6366f1',
                    borderRadius: 5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, grid: { display: false } },
                    x: { grid: { display: false } }
                }
            }
        });
    } catch (err) { console.error('Error loading Best Sellers Chart:', err); }
}

async function loadSalesTrendsChart() {
    try {
        const res = await fetchAuth(`${API_BASE}/reports/trends`);
        const data = await res.json();
        const chartEl = document.getElementById('sales-trends-chart');
        if (!chartEl) return;
        const ctx = chartEl.getContext('2d');

        if (typeof Chart === 'undefined') {
            console.error('Chart.js is not loaded! Retrying in 1s...');
            setTimeout(loadSalesTrendsChart, 1000);
            return;
        }
        
        if (salesTrendsChart) salesTrendsChart.destroy();

        if (data.length === 0) {
            ctx.font = "14px Inter";
            ctx.fillStyle = "#64748b";
            ctx.textAlign = "center";
            ctx.fillText("Start selling to see trends!", chartEl.width / 2, chartEl.height / 2);
            return;
        }
        
        salesTrendsChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map(d => d.hour + ':00'),
                datasets: [{
                    label: 'Revenue',
                    data: data.map(d => d.revenue),
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, grid: { color: '#f1f5f9' } },
                    x: { grid: { display: false } }
                }
            }
        });
    } catch (err) { console.error('Error loading Sales Trends Chart:', err); }
}

// ==== INVENTORY ====
let adminInventoryFilter = null;

async function loadInventory() {
    try {
        const res = await fetchAuth(`${API_BASE}/products`);
        products = await res.json();
        const tbody = document.querySelector('#inventory-table tbody');
        tbody.innerHTML = '';
        
        // Handle admin inventory filtering
        let productsToRender = products;
        const filterBadge = document.getElementById('inventory-filter-badge');
        if (currentRole === 'admin' && adminInventoryFilter) {
            productsToRender = products.filter(p => p.owner_name === adminInventoryFilter);
            document.getElementById('inventory-filter-name').textContent = adminInventoryFilter;
            filterBadge.style.display = 'flex';
        } else {
            filterBadge.style.display = 'none';
        }
        
        productsToRender.forEach(p => {
            const imgHtml = p.image ? `<img src="${p.image}" style="width:40px;height:40px;border-radius:8px;object-fit:cover;">` : `<div style="width:40px;height:40px;border-radius:8px;background:#e2e8f0;display:flex;align-items:center;justify-content:center;font-size:10px;color:#64748b;">No Img</div>`;
            const tr = document.createElement('tr');
            
            let nameDisplay = `<span>${p.name}</span>`;
            if (currentRole === 'admin') {
                nameDisplay = `<div><span>${p.name}</span><div style="font-size:11px;color:var(--primary);margin-top:2px;">[${p.owner_name}]</div></div>`;
            }
            
            tr.innerHTML = `
                <td style="display:flex;align-items:center;gap:12px;">${imgHtml} ${nameDisplay}</td>
                <td class="${p.quantity <= 10 ? 'text-danger' : ''}">${p.quantity}</td>
                <td>${formatCurrency(p.price)}</td>
                <td>
                    <button class="btn btn-outline btn-icon-only edit-btn" data-id="${p.id}"><i class='bx bx-edit'></i></button>
                    <button class="btn btn-danger btn-icon-only del-btn" data-id="${p.id}"><i class='bx bx-trash'></i></button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        
    } catch (err) {
        console.error(err);
    }
}

document.getElementById('btn-clear-inventory-filter').addEventListener('click', () => {
    adminInventoryFilter = null;
    loadInventory();
});

// Event Delegation for Edit and Delete buttons
document.querySelector('#inventory-table tbody').addEventListener('click', (e) => {
    const editBtn = e.target.closest('.edit-btn');
    if (editBtn) {
        editProduct(editBtn.dataset.id);
        return;
    }
    
    const delBtn = e.target.closest('.del-btn');
    if (delBtn) {
        deleteProduct(delBtn.dataset.id);
    }
});

function editProduct(id) {
    const p = products.find(prod => prod.id == id);
    if(p) {
        document.getElementById('product-id').value = p.id;
        document.getElementById('product-name').value = p.name;
        document.getElementById('product-qty').value = p.quantity;
        document.getElementById('product-price').value = p.price;
        document.getElementById('product-cost-price').value = p.cost_price || '';
        document.getElementById('product-barcode').value = p.barcode || '';
        document.getElementById('product-expiry').value = p.expiry_date || '';
        
        currentProductImageBase64 = p.image || null;
        if (p.image) {
            document.getElementById('product-image-preview').innerHTML = `<img src="${p.image}" style="width:100%;height:100%;object-fit:cover;border-radius:10px;">`;
        } else {
            document.getElementById('product-image-preview').innerHTML = '<span style="color:var(--text-muted);font-size:12px;">+ Add Image</span>';
        }
        
        document.getElementById('product-modal-title').textContent = 'Edit Product';
        showModal(productModal);
    }
}

async function deleteProduct(id) {
    if(confirm('Are you sure you want to delete this product?')) {
        try {
            await fetchAuth(`${API_BASE}/products/${id}`, { method: 'DELETE' });
            loadInventory();
        } catch (err) { console.error(err); }
    }
}

document.getElementById('btn-export-inventory').addEventListener('click', () => {
    const csvData = [['Item Name', 'Quantity', 'Price']];
    products.forEach(p => csvData.push([p.name, p.quantity, p.price]));
    exportToCSV('products.csv', csvData);
});

// ==== POS (NEW BILL) ====
async function loadPOS() {
    currentBill = [];
    currentPaymentMethod = 'Cash';
    document.querySelectorAll('.pay-method').forEach(b => b.classList.remove('active'));
    document.querySelector('.pay-method[data-method="Cash"]').classList.add('active');
    
    document.getElementById('pos-discount').value = 0;
    document.getElementById('pos-tax-vat').value = 0;
    
    updateBillUI();
    document.getElementById('pos-search-input').value = '';
    
    try {
        const res = await fetchAuth(`${API_BASE}/products`);
        products = await res.json();
        renderPOSProducts(products);
        loadCustomers(); // Load and populate customers
    } catch (err) {
        console.error(err);
    }
}

async function loadCustomers() {
    try {
        const res = await fetchAuth(`${API_BASE}/customers`);
        customers = await res.json();
        const select = document.getElementById('pos-customer-select');
        const currentVal = select.value;
        select.innerHTML = '<option value="">Guest Customer</option>';
        customers.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id || c._id;
            opt.textContent = `${c.name} (${c.phone})`;
            select.appendChild(opt);
        });
        select.value = currentVal;
    } catch (err) { console.error(err); }
}

document.getElementById('pos-customer-select').addEventListener('change', (e) => {
    const custId = e.target.value;
    const info = document.getElementById('customer-loyalty-info');
    if (custId) {
        const cust = customers.find(c => (c.id || c._id) === custId);
        if (cust) {
            document.getElementById('customer-points').textContent = cust.loyalty_points;
            info.style.display = 'block';
        }
    } else {
        info.style.display = 'none';
    }
});

function setupBarcodeScanner() {
    let barcode = '';
    let lastTime = 0;

    window.addEventListener('keydown', (e) => {
        const currentTime = new Date().getTime();
        
        // Typical barcode scanners send characters very quickly (less than 30ms apart)
        if (currentTime - lastTime > 100) {
            barcode = '';
        }

        if (e.key === 'Enter') {
            if (barcode.length > 2 && currentTab === 'pos-view') {
                handleBarcodeScan(barcode);
                barcode = '';
            }
        } else if (e.key.length === 1) {
            barcode += e.key;
        }

        lastTime = currentTime;
    });
}

function handleBarcodeScan(code) {
    const product = products.find(p => p.barcode === code);
    if (product) {
        addToBill(product);
    } else {
        console.log('Product not found for barcode:', code);
    }
}

function renderPOSProducts(productArray) {
    const grid = document.getElementById('pos-products-grid');
    grid.innerHTML = '';
    
    productArray.forEach(p => {
        const div = document.createElement('div');
        div.className = 'pos-product-card';
        const imgStyle = p.image ? `background-image:url('${p.image}');background-size:cover;background-position:center;` : `background:#e2e8f0;`;
        div.innerHTML = `
            <div style="width:100%;height:100px;border-radius:8px;margin-bottom:12px;${imgStyle}"></div>
            <h4>${p.name}</h4>
            <div class="price">${formatCurrency(p.price)}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">Stock: ${p.quantity}</div>
        `;
        div.addEventListener('click', () => addToBill(p));
        grid.appendChild(div);
    });
}

document.getElementById('pos-search-input').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = products.filter(p => p.name.toLowerCase().includes(term));
    renderPOSProducts(filtered);
});

function addToBill(product) {
    if (product.quantity <= 0) {
        alert('Product out of stock!');
        return;
    }
    
    const existing = currentBill.find(item => item.id === product.id);
    if (existing) {
        if (existing.quantity >= product.quantity) {
             alert('Cannot add more than available stock!');
             return;
        }
        existing.quantity++;
    } else {
        currentBill.push({
            id: product.id,
            name: product.name,
            price: product.price,
            quantity: 1,
            maxQty: product.quantity
        });
    }
    updateBillUI();
}

function updateBillQuantity(id, change) {
    const item = currentBill.find(i => i.id === id);
    if (item) {
        const newQty = item.quantity + change;
        if (newQty > 0 && newQty <= item.maxQty) {
            item.quantity = newQty;
        } else if (newQty === 0) {
            currentBill = currentBill.filter(i => i.id !== id);
        } else {
             alert('Cannot exceed available stock!');
        }
        updateBillUI();
    }
}

function updateBillUI() {
    const itemsContainer = document.getElementById('pos-bill-items');
    itemsContainer.innerHTML = '';
    let subtotal = 0;
    
    currentBill.forEach(item => {
        const amount = item.price * item.quantity;
        subtotal += amount;
        
        const div = document.createElement('div');
        div.className = 'bill-item';
        div.innerHTML = `
            <div class="bill-item-details">
                <h4>${item.name}</h4>
                <p>${formatCurrency(item.price)} x ${item.quantity}</p>
            </div>
            <div class="bill-item-actions">
                <div class="qty-control">
                    <button class="qty-btn" onclick="updateBillQuantity('${item.id}', -1)">-</button>
                    <span>${item.quantity}</span>
                    <button class="qty-btn" onclick="updateBillQuantity('${item.id}', 1)">+</button>
                </div>
                <div class="item-total">${formatCurrency(amount)}</div>
            </div>
        `;
        itemsContainer.appendChild(div);
    });
    
    const discount = parseFloat(document.getElementById('pos-discount').value) || 0;
    const vatPercent = parseFloat(document.getElementById('pos-tax-vat').value) || 0;
    
    const taxVat = (subtotal - discount) * (vatPercent / 100);
    const total = subtotal - discount + taxVat;
    
    document.getElementById('pos-subtotal').textContent = formatCurrency(subtotal);
    document.getElementById('pos-total-amount').textContent = formatCurrency(total);
}

document.getElementById('btn-submit-bill').addEventListener('click', async () => {
    if (currentBill.length === 0) {
        alert('Bill is empty!');
        return;
    }
    
    const subtotal = currentBill.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const discount = parseFloat(document.getElementById('pos-discount').value) || 0;
    const vatPercent = parseFloat(document.getElementById('pos-tax-vat').value) || 0;
    const taxVat = (subtotal - discount) * (vatPercent / 100);
    const total = subtotal - discount + taxVat;
    
    const payload = {
        items: currentBill,
        total_amount: total,
        payment_method: currentPaymentMethod,
        discount_total: discount,
        tax_vat: taxVat,
        customer_id: document.getElementById('pos-customer-select').value || null
    };
    
    try {
        const res = await fetchAuth(`${API_BASE}/invoices`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!res.ok) throw new Error('Failed to create invoice');
        const data = await res.json();
        showInvoicePrintout({ ...data.invoice, payment_method: currentPaymentMethod, discount_total: discount, tax_vat: taxVat });
    } catch (err) {
        console.warn('Network error, saving invoice locally for sync:', err);
        saveInvoiceOffline(payload);
        // Show a local version of the receipt
        const offlineInvoice = {
            ...payload,
            invoice_number: 'OFF-' + Date.now().toString().slice(-6),
            date: new Date().toISOString().split('T')[0],
            time: new Date().toTimeString().split(' ')[0].substring(0, 5)
        };
        showInvoicePrintout(offlineInvoice);
        alert('Saved offline. Will sync when internet is back.');
    } finally {
        // Clear bill anyway
        currentBill = [];
        updateBillUI();
        // Reload products cache if possible
        fetchAuth(`${API_BASE}/products`).then(r => r.json()).then(p => products = p).catch(() => {});
    }
});

function saveInvoiceOffline(payload) {
    const offlineInvoices = JSON.parse(localStorage.getItem('pos_offline_invoices') || '[]');
    offlineInvoices.push(payload);
    localStorage.setItem('pos_offline_invoices', JSON.stringify(offlineInvoices));
    updateSyncIndicator();
}

async function syncOfflineInvoices() {
    const offlineInvoices = JSON.parse(localStorage.getItem('pos_offline_invoices') || '[]');
    if (offlineInvoices.length === 0) return;

    document.getElementById('sync-status').style.display = 'flex';
    
    const remaining = [];
    for (const inv of offlineInvoices) {
        try {
            const res = await fetchAuth(`${API_BASE}/invoices`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(inv)
            });
            if (!res.ok) throw new Error();
        } catch (err) {
            remaining.push(inv);
        }
    }

    localStorage.setItem('pos_offline_invoices', JSON.stringify(remaining));
    updateSyncIndicator();
    
    if (remaining.length === 0) {
        setTimeout(() => {
            document.getElementById('sync-status').style.display = 'none';
        }, 3000);
    }
}

function updateSyncIndicator() {
    const offlineInvoices = JSON.parse(localStorage.getItem('pos_offline_invoices') || '[]');
    const indicator = document.getElementById('sync-status');
    if (offlineInvoices.length > 0) {
        indicator.style.display = 'flex';
        indicator.innerHTML = `<i class='bx bx-sync bx-spin'></i> Syncing ${offlineInvoices.length} bills...`;
    }
}

window.addEventListener('online', syncOfflineInvoices);
setInterval(syncOfflineInvoices, 30000); // Check every 30s

function showInvoicePrintout(invoice) {
    document.getElementById('receipt-business-name').textContent = currentBusiness.toUpperCase() || 'SHAMOD POS';
    document.getElementById('receipt-no').textContent = invoice.invoice_number;
    document.getElementById('receipt-date').textContent = invoice.date;
    document.getElementById('receipt-time').textContent = invoice.time;
    
    const tbody = document.querySelector('#receipt-items tbody');
    tbody.innerHTML = '';
    
    let subtotal = 0;
    invoice.items.forEach(item => {
        const amt = item.price * item.quantity;
        subtotal += amt;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${item.product_name || item.name}</td>
            <td>${item.quantity}</td>
            <td>${item.price}</td>
            <td>${amt}</td>
        `;
        tbody.appendChild(tr);
    });
    
    const receiptExtra = document.createElement('div');
    receiptExtra.innerHTML = `
        <p>----------------------------</p>
        <div style="display:flex; justify-content:space-between;"><span>Subtotal:</span><span>${subtotal.toFixed(2)}</span></div>
        <div style="display:flex; justify-content:space-between;"><span>Discount:</span><span>-${(invoice.discount_total || 0).toFixed(2)}</span></div>
        <div style="display:flex; justify-content:space-between;"><span>VAT:</span><span>+${(invoice.tax_vat || 0).toFixed(2)}</span></div>
        <div style="display:flex; justify-content:space-between;"><span>Pay Method:</span><span>${invoice.payment_method || 'Cash'}</span></div>
    `;
    
    const existingExtra = document.getElementById('receipt-extra-info');
    if (existingExtra) existingExtra.remove();
    receiptExtra.id = 'receipt-extra-info';
    document.querySelector('.receipt-total').before(receiptExtra);

    document.getElementById('receipt-total-amount').textContent = invoice.total_amount.toFixed(2);
    
    // Add Share buttons to modal footer
    const footer = document.querySelector('#invoice-modal .modal-footer');
    const existingShare = document.getElementById('share-buttons');
    if (existingShare) existingShare.remove();
    
    const shareDiv = document.createElement('div');
    shareDiv.id = 'share-buttons';
    shareDiv.style.marginTop = '10px';
    shareDiv.style.display = 'flex';
    shareDiv.style.gap = '10px';
    
    const waBtn = document.createElement('button');
    waBtn.className = 'btn btn-outline btn-block';
    waBtn.innerHTML = '<i class="bx bxl-whatsapp"></i> Share WhatsApp';
    waBtn.onclick = () => {
        const text = `Invoice: ${invoice.invoice_number}\nDate: ${invoice.date}\nTotal: ${invoice.total_amount}\nThank you for shopping with ${currentBusiness}!`;
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    };
    
    shareDiv.appendChild(waBtn);
    footer.appendChild(shareDiv);

    // Automatically open modal and print dialog
    showModal(invoiceModal);
    setTimeout(() => {
        window.print();
    }, 500);
}

// ==== INVOICES ====
let invoicesList = [];

async function loadInvoices() {
    const dateFilter = document.getElementById('filter-date').value;
    const monthFilter = document.getElementById('filter-month').value;
    
    let url = `${API_BASE}/invoices`;
    if (dateFilter) url += `?date=${dateFilter}`;
    else if (monthFilter) url += `?month=${monthFilter}`;
    
    try {
        const res = await fetchAuth(url);
        invoicesList = await res.json();
        const tbody = document.querySelector('#invoices-table tbody');
        tbody.innerHTML = '';
        
        invoicesList.forEach(inv => {
            const tr = document.createElement('tr');
            let adminActions = '';
            let invDisplay = inv.invoice_number;
            if (currentRole === 'admin') {
                invDisplay += `<div style="font-size:11px;color:var(--primary);margin-top:2px;">[${inv.owner_name}]</div>`;
                adminActions = `<button class="btn btn-danger btn-icon-only delete-invoice-btn" style="margin-left: 4px;" data-id="${inv.id}"><i class='bx bx-trash'></i></button>`;
            }
            
            tr.innerHTML = `
                <td>${invDisplay}</td>
                <td>${inv.date}</td>
                <td>${inv.time}</td>
                <td style="font-weight:bold">${formatCurrency(inv.total_amount)}</td>
                <td>
                    <button class="btn btn-outline btn-icon-only view-invoice-btn" data-id="${inv.id}"><i class='bx bx-show'></i></button>
                    <button class="btn btn-primary btn-icon-only print-invoice-btn" data-id="${inv.id}"><i class='bx bx-printer'></i></button>
                    ${adminActions}
                </td>
            `;
            tbody.appendChild(tr);
        });

        document.querySelectorAll('.view-invoice-btn, .print-invoice-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.currentTarget.dataset.id;
                try {
                    const res = await fetchAuth(`${API_BASE}/invoices/${id}`);
                    const inv = await res.json();
                    showInvoicePrintout(inv);
                } catch(err) { console.error(err); }
            });
        });
        
        document.querySelectorAll('.delete-invoice-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                if(confirm('Are you sure you want to delete this invoice? (This will restock the inventory automatically)')) {
                    const id = e.currentTarget.dataset.id;
                    try {
                        await fetchAuth(`${API_BASE}/invoices/${id}`, { method: 'DELETE' });
                        loadInvoices();
                    } catch(err) { console.error(err); }
                }
            });
        });
        
    } catch (err) {
        console.error(err);
    }
}

document.getElementById('filter-date').addEventListener('change', () => {
    document.getElementById('filter-month').value = '';
    loadInvoices();
});
document.getElementById('filter-month').addEventListener('change', () => {
    document.getElementById('filter-date').value = '';
    loadInvoices();
});
document.getElementById('btn-clear-filters').addEventListener('click', () => {
    document.getElementById('filter-date').value = '';
    document.getElementById('filter-month').value = '';
    loadInvoices();
});

document.getElementById('btn-export-invoices').addEventListener('click', () => {
    const csvData = [['Invoice Number', 'Date', 'Time', 'Total Amount']];
    invoicesList.forEach(i => csvData.push([i.invoice_number, i.date, i.time, i.total_amount]));
    exportToCSV('invoices.csv', csvData);
});

// ==== REPORTS ====
let currentReportMode = 'sales';

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab-btn').forEach(td => td.classList.remove('active'));
        e.target.classList.add('active');
        currentReportMode = e.target.getAttribute('data-report');
        loadReports();
    });
});

async function loadReports() {
    const thead = document.querySelector('#reports-table document, #reports-table thead');
    const tbody = document.querySelector('#reports-table tbody');
    tbody.innerHTML = '';
    
    try {
        if (currentReportMode === 'sales') {
            thead.innerHTML = `<tr><th>Date</th><th>Total Sales</th></tr>`;
            const res = await fetchAuth(`${API_BASE}/reports/sales`);
            const data = await res.json();
            data.forEach(row => {
               const tr = document.createElement('tr');
               tr.innerHTML = `<td>${row.date}</td><td>${formatCurrency(row.total_sales)}</td>`;
               tbody.appendChild(tr);
            });
        } else {
            thead.innerHTML = `<tr><th>Product Name</th><th>Quantity Sold</th><th>Revenue</th></tr>`;
            const res = await fetchAuth(`${API_BASE}/reports/product-sales`);
            const data = await res.json();
            data.forEach(row => {
               const tr = document.createElement('tr');
               tr.innerHTML = `<td>${row.product_name}</td><td>${row.quantity_sold}</td><td>${formatCurrency(row.revenue)}</td>`;
               tbody.appendChild(tr);
            });
        }
    } catch (err) {
        console.error(err);
    }
}

// ==== ADMIN VIEW ====
let adminUsersList = [];

async function loadAdminUsers() {
    try {
        const res = await fetchAuth(`${API_BASE}/admin/users`);
        adminUsersList = await res.json();
        
        const tbody = document.querySelector('#admin-users-table tbody');
        tbody.innerHTML = '';
        
        adminUsersList.forEach(user => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${user.business_name}</td>
                <td>${user.email}</td>
                <td>${user.marketplace_enabled ? '<span class="text-success" style="color:var(--success);font-weight:600;">Enabled</span>' : '<span class="text-muted">Disabled</span>'}</td>
                <td>
                    <button class="btn btn-outline btn-icon-only view-user-inventory-btn" data-id="${user.id}" title="View Inventory"><i class='bx bx-box'></i></button>
                    <button class="btn btn-outline btn-icon-only admin-edit-btn" data-id="${user.id}" title="Edit User"><i class='bx bx-edit'></i></button>
                    <button class="btn btn-danger btn-icon-only admin-del-btn" data-id="${user.id}" title="Delete User"><i class='bx bx-trash'></i></button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error(err);
    }
}

// Event Delegation for Admin Users Edit/Delete
document.querySelector('#admin-users-table tbody').addEventListener('click', async (e) => {
    const viewInvBtn = e.target.closest('.view-user-inventory-btn');
    if (viewInvBtn) {
        const id = viewInvBtn.dataset.id;
        const user = adminUsersList.find(u => u.id === id);
        if (user) {
            // Set filter and switch tabs
            adminInventoryFilter = user.business_name;
            
            navLinks.forEach(l => l.classList.remove('active'));
            document.querySelector('[data-target="inventory-view"]').classList.add('active');
            
            views.forEach(v => v.classList.remove('active'));
            document.getElementById('inventory-view').classList.add('active');
            
            pageTitle.textContent = "Inventory";
            currentTab = 'inventory-view';
            loadInventory();
        }
        return;
    }

    const editBtn = e.target.closest('.admin-edit-btn');
    if (editBtn) {
        const id = editBtn.dataset.id;
        const user = adminUsersList.find(u => u.id === id);
        if (user) {
            document.getElementById('admin-user-id').value = user.id;
            document.getElementById('admin-business-name').value = user.business_name;
            document.getElementById('admin-email').value = user.email;
            document.getElementById('admin-whatsapp').value = user.whatsapp_number || '';
            document.getElementById('admin-password').value = ''; // Always clear password field
            document.getElementById('admin-marketplace-enabled').checked = user.marketplace_enabled;
            showModal(adminUserModal);
        }
        return;
    }
    
    const delBtn = e.target.closest('.admin-del-btn');
    if (delBtn) {
        if(confirm('Are you sure you want to permanently delete this user and ALL their data (products, invoices)?')) {
            try {
                await fetchAuth(`${API_BASE}/admin/users/${delBtn.dataset.id}`, { method: 'DELETE' });
                loadAdminUsers();
            } catch (err) { console.error(err); }
        }
    }
});
