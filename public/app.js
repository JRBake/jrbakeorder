const API_BASE = 'https://jrbakeorder-645749447527.us-east1.run.app';

const inventoryList = document.getElementById('inventoryList');
const orderForm = document.getElementById('orderForm');
const successMessage = document.getElementById('successMessage');
const phoneInput = document.getElementById('phone');
const orderTotalEl = document.getElementById('orderTotal');
const slicingSection = document.getElementById('slicingSection');
const pickupDiv = document.getElementById('pickupInfo');
const pickupText = document.getElementById('pickupText');

// 1. PHONE MASKING
phoneInput.addEventListener('input', (e) => {
    const numbers = e.target.value.replace(/\D/g, '');
    if (numbers.length <= 3) e.target.value = numbers;
    else if (numbers.length <= 6) e.target.value = `(${numbers.slice(0, 3)}) ${numbers.slice(3)}`;
    else e.target.value = `(${numbers.slice(0, 3)}) ${numbers.slice(3, 6)}-${numbers.slice(6, 10)}`;
});

// 2. LOAD INVENTORY
async function loadInventory() {
    try {
        const response = await fetch(`${API_BASE}/inventory`);
        const data = await response.json();

        const itemsToRender = data.inventory || (Array.isArray(data) ? data : []);
        const pickupData = data.pickup || null;

        // 1. ALWAYS SHOW PICKUP INFO (if it exists)
        // We define these inside the function to ensure we grab them every refresh
        const pickupDiv = document.getElementById('pickupInfo');
        const pickupText = document.getElementById('pickupText');
        const soldOutMessage = document.getElementById('soldOutMessage');

if (pickupData && pickupData.template) {
    let message = pickupData.template;

    // Replace the placeholders with the real data
    // We use a global regex /.../g so it replaces every instance found
    message = message.replace(/{DATE}/g, `<strong>${pickupData.date || 'TBD'}</strong>`);
    message = message.replace(/{REGULARHOURS}/g, `<strong>${pickupData.hours || 'TBD'}</strong>`);
    message = message.replace(/{AFTERHOURS}/g, `<strong>${pickupData.afterHours || 'TBD'}</strong>`);

    if (pickupText) {
        pickupText.innerHTML = message;
    }

    if (pickupDiv) {
        pickupDiv.classList.remove('hidden');
        pickupDiv.style.display = 'block';
    }
} else {
    // Fallback if F5 is empty
    if (pickupText) pickupText.innerText = "Check back soon for pickup details!";
}

        // 2. FILTER FOR STOCK
        inventoryList.innerHTML = '';
        const availableItems = itemsToRender.filter(item => item.stock > 0);

        // 3. TOGGLE "SOLD OUT" vs "ORDER FORM"
        if (availableItems.length === 0) {
            // --- SOLD OUT STATE ---
            if (soldOutMessage) {
                soldOutMessage.classList.remove('hidden');
                soldOutMessage.style.display = 'block';
            }
            if (orderForm) orderForm.style.display = 'none';
            if (orderTotalEl) orderTotalEl.style.display = 'none';
            if (slicingSection) slicingSection.style.display = 'none';

            console.log("Bakery is sold out. Pickup info remains visible.");
        } else {
            // --- ACTIVE STORE STATE ---
            if (soldOutMessage) {
                soldOutMessage.classList.add('hidden');
                soldOutMessage.style.display = 'none';
            }
            if (orderForm) orderForm.style.display = 'block';
            if (orderTotalEl) orderTotalEl.style.display = 'block';

            // Render the items
            availableItems.forEach(item => {
                const div = document.createElement('div');
                div.className = 'inventory-item';
                div.innerHTML = `
                    <input type="checkbox" class="item-checkbox hidden-checkbox"
                        data-item="${item.item}"
                        data-price="${item.price}"
                        data-stock="${item.stock}"
                        data-category="${item.category}"/>

                    <div class="image-wrapper"><img src="${item.image}" class="product-img"></div>

                    <div class="inventory-details">
                        <div class="inventory-name">
                            <strong>${item.item}</strong>
                            <div>$${Number(item.price).toFixed(2)}</div>
                        </div>
                        <p class="item-description" style="font-size: 0.9em; color: #666; margin: 5px 0;">
                            ${item.description || ''}
                        </p>
                        <div class="item-subtotal">Subtotal: $0.00</div>
                    </div>

                    <div class="cart-controls">
                        <button type="button" class="qty-minus">−</button>
                        <input type="number" class="quantity-input" value="0" min="0" />
                        <button type="button" class="qty-plus">+</button>
                    </div>
                `;
                inventoryList.appendChild(div);
            });

            setupCartEventListeners();
            updateUI();
        }

    } catch (error) {
        console.error("Load Inventory Error:", error);
        inventoryList.innerHTML = '<p style="color: red; text-align: center;">System offline. Please check back later.</p>';
    }
}

// 3. CART UI LOGIC
function setupCartEventListeners() {
    document.querySelectorAll('.inventory-item').forEach(itemDiv => {
        const checkbox = itemDiv.querySelector('.item-checkbox');
        const qtyInput = itemDiv.querySelector('.quantity-input');
        const max = parseInt(checkbox.dataset.stock);

        itemDiv.querySelector('.qty-plus').onclick = () => {
            let val = parseInt(qtyInput.value) || 0;
            if (val < max) {
                qtyInput.value = val + 1;
                updateUI();
            }
        };

        itemDiv.querySelector('.qty-minus').onclick = () => {
            let val = parseInt(qtyInput.value) || 0;
            if (val > 0) {
                qtyInput.value = val - 1;
                updateUI();
            }
        };

        qtyInput.oninput = () => {
            let val = parseInt(qtyInput.value);
            if (isNaN(val) || val < 0) val = 0;
            if (val > max) val = max;
            qtyInput.value = val;
            updateUI();
        };
    });
}

function updateUI() {
    let total = 0;
    let hasLoaf = false;

    document.querySelectorAll('.inventory-item').forEach(itemDiv => {
        const checkbox = itemDiv.querySelector('.item-checkbox');
        const qtyInput = itemDiv.querySelector('.quantity-input');
        const qty = parseInt(qtyInput.value) || 0;

        if (qty > 0) {
            itemDiv.classList.add('selected');
            checkbox.checked = true;
        } else {
            itemDiv.classList.remove('selected');
            checkbox.checked = false;
        }

        const price = parseFloat(checkbox.dataset.price);
        if (checkbox.checked && (checkbox.dataset.category === "Loaf" || checkbox.dataset.item.toLowerCase().includes('sourdough'))) {
            hasLoaf = true;
        }

        const subtotal = qty * price;
        itemDiv.querySelector('.item-subtotal').innerText = `Subtotal: $${subtotal.toFixed(2)}`;
        total += subtotal;
    });

    if (slicingSection) {
        slicingSection.classList.toggle('hidden', !hasLoaf);
    }

    orderTotalEl.innerHTML = `Total: <strong>$${total.toFixed(2)}</strong>`;
    const submitBtn = orderForm.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = total <= 0;
}

// 4. ORDER SUBMISSION
orderForm.onsubmit = async (e) => {
    e.preventDefault();
    const submitBtn = orderForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.innerText = "Sending Order...";

    const selectedItems = [];
    let containsLoaf = false;

    document.querySelectorAll('.inventory-item').forEach(itemDiv => {
        const checkbox = itemDiv.querySelector('.item-checkbox');
        const qtyInput = itemDiv.querySelector('.quantity-input');
        const qty = parseInt(qtyInput.value);
        if (qty > 0) {
            selectedItems.push({
                item: checkbox.dataset.item,
                quantity: qty,
                price: parseFloat(checkbox.dataset.price)
            });
            if (checkbox.dataset.category === "Loaf" || checkbox.dataset.item.toLowerCase().includes('sourdough')) {
                containsLoaf = true;
            }
        }
    });

    const slicingPref = document.querySelector('input[name="slicing"]:checked')?.value || "No";

    const payload = {
        firstName: document.getElementById('firstName').value,
        lastName: document.getElementById('lastName').value,
        email: document.getElementById('email').value,
        phone: document.getElementById('phone').value,
        items: selectedItems,
        slicing: containsLoaf ? slicingPref : "N/A",
        payment: document.getElementById('paymentMethod').value,
        notes: document.getElementById('orderNotes').value || "None"
    };

    try {
        const response = await fetch(`${API_BASE}/order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Submission failed');

        submitBtn.innerText = "Order Sent! 🍞";
        submitBtn.style.backgroundColor = "#4CAF50";
        submitBtn.style.color = "white";

        successMessage.classList.remove('hidden');
        successMessage.innerHTML = `🍞 Order Success! Order #: <strong>${result.orderNumber}</strong>`;
        orderForm.reset();
        loadInventory();

    } catch (err) {
        alert(err.message);
        submitBtn.disabled = false;
        submitBtn.innerText = "Place Order";
    }
};

loadInventory();
