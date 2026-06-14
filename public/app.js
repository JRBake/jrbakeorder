const API_BASE = 'https://jrbakeorder-645749447527.us-east1.run.app';

const inventoryList = document.getElementById('inventoryList');
const orderForm = document.getElementById('orderForm');
const successMessage = document.getElementById('successMessage');
const phoneInput = document.getElementById('phone');
const orderTotalEl = document.getElementById('orderTotal');
const slicingSection = document.getElementById('slicingSection');
const pickupDiv = document.getElementById('pickupInfo');
const pickupText = document.getElementById('pickupText');
const errorMessage = document.getElementById('errorMessage');

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
        const isOpen = data.isOpen ?? true; // Default to open if missing

        // Define these inside the function to ensure we grab them every refresh
        const pickupDiv = document.getElementById('pickupInfo');
        const pickupText = document.getElementById('pickupText');
        const soldOutMessage = document.getElementById('soldOutMessage');

        if (pickupData && pickupData.template) {
            let message = pickupData.template;

            // Replace the placeholders with the real data
            message = message.replace(/{DATE}/g, `<strong>${pickupData.date || 'TBD'}</strong>`);
            message = message.replace(/{REGULARHOURS}/g, `<strong>${pickupData.hours || 'TBD'}</strong>`);
            message = message.replace(/{AFTERHOURS}/g, `<strong>${pickupData.afterHours || 'TBD'}</strong>`);

            if (pickupText) {
                pickupText.innerHTML = message;
            }
        } // 👈 FIXED: Added this missing closing bracket to close the pickup template wrapper!

        // --- MASTER TOGGLE CONTROL (F6) ---
        if (!isOpen) {
            // If F6 is "No", hide everything and show the master closed/sold out screen
            if (soldOutMessage) {
                soldOutMessage.classList.remove('hidden');
                soldOutMessage.style.display = 'block';
            }
            if (orderForm) orderForm.style.display = 'none';
            if (orderTotalEl) orderTotalEl.style.display = 'none';
            if (slicingSection) slicingSection.style.display = 'none';
            if (pickupDiv) {
                pickupDiv.classList.add('hidden');
                pickupDiv.style.display = 'none';
            }
            return; // Exit early
        }

        // --- STORE IS OPEN (F6 is "Yes") ---
        if (soldOutMessage) {
            soldOutMessage.classList.add('hidden');
            soldOutMessage.style.display = 'none';
        }
        if (orderForm) orderForm.style.display = 'block';
        if (orderTotalEl) orderTotalEl.style.display = 'block';
        if (pickupDiv) {
            pickupDiv.classList.remove('hidden');
            pickupDiv.style.display = 'block';
        }

        inventoryList.innerHTML = '';

        // Render ALL items (even if stock is 0)
        itemsToRender.forEach(item => {
            const isSoldOut = item.stock <= 0;

            // Swap out the regular price layout for a red SOLD OUT message when stock hits 0
            const statusDisplayHtml = isSoldOut
                ? `<div style="color: #c62828; font-weight: bold; font-size: 0.95em; text-transform: uppercase; margin-top: 2px;">● Sold Out</div>`
                : `<div>$${Number(item.price).toFixed(2)}</div>`;

            const div = document.createElement('div');
            // Give it an extra class name if it is sold out so we can apply specific style rules
            div.className = `inventory-item ${isSoldOut ? 'sold-out-item' : ''}`;

            div.innerHTML = `
                <input type="checkbox" class="item-checkbox hidden-checkbox"
                    data-item="${item.item}"
                    data-price="${item.price}"
                    data-stock="${item.stock}"
                    data-category="${item.category}"/>

                <div class="image-wrapper" style="${isSoldOut ? 'opacity: 0.5; filter: grayscale(60%);' : ''}">
                    <img src="${item.image}" class="product-img">
                </div>

                <div class="inventory-details" style="${isSoldOut ? 'color: #999;' : ''}">
                    <div class="inventory-name">
                        <strong>${item.item}</strong>
                        ${statusDisplayHtml}
                    </div>
                    <p class="item-description" style="font-size: 0.9em; color: #666; margin: 5px 0;">
                        ${item.description || ''}
                    </p>
                    <div class="item-subtotal">${isSoldOut ? '' : 'Subtotal: $0.00'}</div>
                </div>

                <div class="cart-controls">
                    <button type="button" class="qty-minus" ${isSoldOut ? 'disabled style="opacity: 0.3; cursor: not-allowed;"' : ''}>−</button>
                    <input type="number" class="quantity-input" value="0" min="0" ${isSoldOut ? 'disabled style="background: #eaeaea; color: #aaa; cursor: not-allowed;"' : ''} />
                    <button type="button" class="qty-plus" ${isSoldOut ? 'disabled style="opacity: 0.3; cursor: not-allowed;"' : ''}>+</button>
                </div>
            `;
            inventoryList.appendChild(div);
        });

        setupCartEventListeners();
        updateUI();

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

        // 👇 FIXED: If an item is sold out, skip tying dynamic click listeners to its buttons
        if (max <= 0) return;

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
        // Strictly check for the 'Loaf' category only
        if (checkbox.checked && checkbox.dataset.category === "Loaf") {
            hasLoaf = true;
        }

        const subtotal = qty * price;
        // Only render subtotals for items currently active/purchasable
        if (itemDiv.querySelector('.item-subtotal') && parseInt(checkbox.dataset.stock) > 0) {
            itemDiv.querySelector('.item-subtotal').innerText = `Subtotal: $${subtotal.toFixed(2)}`;
        }
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
            // Strictly check for the 'Loaf' category only
            if (checkbox.dataset.category === "Loaf") {
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

        // DETECT STOCK SHORTAGES FROM OTHER USERS
        if (response.status === 409 && result.error === "STOCK_SHORTAGE") {
            submitBtn.disabled = false;
            submitBtn.innerText = "Place Order";

            // Build a clean, inline HTML message listing the changes
            let errorHtml = `<strong>⚠️ Inventory Update!</strong><br>Someone just snatched up some of those items! We've updated your cart with what we have left:<br><ul style="margin-top: 10px; margin-bottom: 10px; padding-left: 20px;">`;

            // Update the UI numbers to match reality
            for (const shortage of result.shortages) {
                const itemDiv = Array.from(document.querySelectorAll('.inventory-item'))
                    .find(div => div.querySelector('.item-checkbox').dataset.item === shortage.item);

                if (itemDiv) {
                    const checkbox = itemDiv.querySelector('.item-checkbox');
                    const qtyInput = itemDiv.querySelector('.quantity-input');

                    checkbox.dataset.stock = shortage.available;
                    qtyInput.value = shortage.available;

                    // Add this specific item to our red warning box list
                    errorHtml += `<li><strong>${shortage.item}:</strong> Only ${shortage.available} left</li>`;
                }
            }

            errorHtml += `</ul>Please review your updated quantities and click 'Place Order' again if you'd like to proceed.`;

            // Display the red warning box
            if (errorMessage) {
                errorMessage.innerHTML = errorHtml;
                errorMessage.classList.remove('hidden');
                errorMessage.style.display = 'block';
            }

            updateUI();
            return; // Stop here so they can review
        }

        if (!response.ok) throw new Error(result.error || 'Submission failed');

        submitBtn.innerText = "Order Sent! 🍞";
        submitBtn.style.backgroundColor = "#4CAF50";
        submitBtn.style.color = "white";

        if (errorMessage) {
            errorMessage.classList.add('hidden');
            errorMessage.style.display = 'none';
        }

        successMessage.classList.remove('hidden');
        successMessage.innerHTML = `🍞 Order Success! Order #: <strong>${result.orderNumber}</strong><br>Please check your email for your receipt and to pay with online payment processors.`;
        orderForm.reset();
        loadInventory();

    } catch (err) {
        alert(err.message);
        submitBtn.disabled = false;
        submitBtn.innerText = "Place Order";
    }
};

loadInventory();
