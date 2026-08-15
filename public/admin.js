let adminToken = '';
let standingOrdersList = [];

const loginSection = document.getElementById('loginSection');
const portalSection = document.getElementById('portalSection');
const adminPasswordInput = document.getElementById('adminPassword');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');

const customerSelect = document.getElementById('customerSelect');
const customerDetails = document.getElementById('customerDetails');
const sendReceiptBtn = document.getElementById('sendReceiptBtn');
const adminMessage = document.getElementById('adminMessage');

// 1. Authenticate & Fetch List
loginBtn.onclick = async () => {
    adminToken = adminPasswordInput.value.trim();
    loginError.style.display = 'none';

    try {
        const res = await fetch('/api/admin/standing-orders', {
            headers: { 'Authorization': adminToken }
        });

        if (!res.ok) {
            loginError.style.display = 'block';
            return;
        }

        const data = await res.json();
        standingOrdersList = data.standingOrders;

        loginSection.classList.add('hidden');
        portalSection.classList.remove('hidden');
        populateCustomerDropdown();

    } catch (err) {
        loginError.innerText = 'Network error cleanly connecting to server.';
        loginError.style.display = 'block';
    }
};

// 2. Populate Dropdown Options
function populateCustomerDropdown() {
    customerSelect.innerHTML = '<option value="">-- Select a Customer --</option>';

    standingOrdersList.forEach((order, index) => {
        const opt = document.createElement('option');
        opt.value = index;
        opt.textContent = `${order.firstName} ${order.lastName} (${order.email}) - $${order.total.toFixed(2)}`;
        customerSelect.appendChild(opt);
    });
}

// 3. Render Selected Customer
customerSelect.onchange = () => {
    const selectedIdx = customerSelect.value;
    if (selectedIdx === '') {
        customerDetails.classList.add('hidden');
        return;
    }

    const order = standingOrdersList[selectedIdx];
    document.getElementById('custName').innerText = `${order.firstName} ${order.lastName}`;
    document.getElementById('custStatus').innerText = `Status: ${order.receiptStatus}`;
    document.getElementById('custEmail').innerText = order.email;
    document.getElementById('custPhone').innerText = order.phone || 'N/A';
    document.getElementById('custPayment').innerText = order.payment;
    document.getElementById('custSlicing').innerText = order.slicing;
    document.getElementById('custTotal').innerText = order.total.toFixed(2);
    document.getElementById('custNotes').innerText = order.notes || 'None';

    customerDetails.classList.remove('hidden');
    adminMessage.classList.add('hidden');
};

// 4. Send Receipt Action
sendReceiptBtn.onclick = async () => {
    const selectedIdx = customerSelect.value;
    if (selectedIdx === '') return;

    const order = standingOrdersList[selectedIdx];
    const pickupOverride = document.getElementById('pickupDateOverride').value.trim();

    sendReceiptBtn.disabled = true;
    sendReceiptBtn.innerText = 'Sending Receipt...';

    try {
        const res = await fetch('/api/admin/send-standing-receipt', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': adminToken
            },
            body: JSON.stringify({
                order: order,
                pickupDateText: pickupOverride
            })
        });

        const result = await res.json();

        if (res.ok && result.success) {
            adminMessage.style.backgroundColor = '#e8f5e9';
            adminMessage.style.color = '#2e7d32';
            adminMessage.innerHTML = `<strong>Receipt Sent!</strong> Receipt #SO-${result.receiptNumber} was emailed to ${order.email}. Sheet updated with: <em>${result.timestamp}</em>`;
            adminMessage.classList.remove('hidden');

            // Update in-memory status representation
            order.receiptStatus = result.timestamp;
            document.getElementById('custStatus').innerText = `Status: ${result.timestamp}`;
        } else {
            throw new Error(result.error || 'Failed to send');
        }
    } catch (err) {
        adminMessage.style.backgroundColor = '#ffebee';
        adminMessage.style.color = '#c62828';
        adminMessage.innerText = `Error: ${err.message}`;
        adminMessage.classList.remove('hidden');
    } finally {
        sendReceiptBtn.disabled = false;
        sendReceiptBtn.innerText = '✉️ Send Receipt';
    }
};
